import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { isEntityVisible, isMeshable } from '@acip/editor-core';
import type { EntityId } from '@acip/editor-core';
import { shapeColor } from '../shape-colors';
import { useSession } from '../session-context';

/**
 * Read-only 3D view: derived meshes in, pixels out. All Three.js code stays in
 * this file so the planned packages/viewer-3d extraction is a file move.
 * World convention: plan is XY, Z is up.
 */

/** how long a focus glide takes; long enough to follow, short enough to wait */
const FOCUS_MS = 450;

/** the model sits on this, so it is standing on something rather than floating */
const GROUND_SIZE = 400;

/** ease-out cubic — fast away from the old view, gentle into the new one */
function ease(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export function Viewer3D() {
  const session = useSession();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio || 1);
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xeef1f4);

    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 4000);
    camera.up.set(0, 0, 1);
    camera.position.set(18, -18, 14);

    /**
     * Lit from every direction but below.
     *
     * One sun left every north-facing wall in flat shade, which on a white
     * model reads as a hole rather than a surface. A hemisphere puts sky above
     * and bounced ground light below, and four low suns around the compass
     * mean no face is ever the one nobody is lighting. None of them sits under
     * the floor: light arriving from beneath is the one direction that never
     * happens outdoors, and it makes a model look like an X-ray.
     */
    scene.add(new THREE.AmbientLight(0xffffff, 0.35));
    scene.add(new THREE.HemisphereLight(0xdfeaff, 0x9a958c, 0.7));
    const compass: [number, number, number][] = [
      [30, -20, 26],
      [-28, -22, 22],
      [26, 24, 20],
      [-24, 26, 24],
      [0, 0, 40],
    ];
    for (const [x, y, z] of compass) {
      const light = new THREE.DirectionalLight(0xffffff, 0.34);
      light.position.set(x, y, z);
      scene.add(light);
    }

    /**
     * The ground. Not a grid — a grid is a drafting aid, and this view is for
     * showing somebody the building rather than for drawing it. Without
     * something underneath, a model with no slab under it floats in the middle
     * of nothing and there is no way to read which way is down.
     *
     * A hair below zero so it never fights a floor slab for the same pixels.
     */
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE),
      new THREE.MeshStandardMaterial({ color: 0xdfe3e7, roughness: 1 }),
    );
    ground.position.z = -0.002;
    scene.add(ground);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    /**
     * The camera's TARGET is what moves when you pan, and it used to be nailed
     * to the origin — so a plan drawn away from it could be orbited around a
     * point outside the building and never centred.
     *
     * Screen-space panning, because the alternative pans along the ground
     * plane: looking down at a roof that means a drag barely moves anything,
     * which is exactly when somebody is trying to pan.
     */
    controls.enablePan = true;
    controls.screenSpacePanning = true;
    controls.touches = {
      ONE: THREE.TOUCH.ROTATE,
      TWO: THREE.TOUCH.DOLLY_PAN,
    };

    const meshGroup = new THREE.Group();
    scene.add(meshGroup);

    // one Three material per KIND, not per document material: the plan and the
    // model now colour by what a thing is, so the whole model needs as many
    // materials as there are kinds of thing — a handful, shared by every mesh
    const materialCache = new Map<string, THREE.MeshStandardMaterial>();
    const disposeMaterials = () => {
      for (const m of materialCache.values()) m.dispose();
      materialCache.clear();
    };
    const materialFor = (type: string): THREE.MeshStandardMaterial => {
      const cached = materialCache.get(type);
      if (cached) return cached;
      const created = new THREE.MeshStandardMaterial({
        color: new THREE.Color(shapeColor(type)),
        side: THREE.DoubleSide,
        roughness: 0.85,
      });
      materialCache.set(type, created);
      return created;
    };

    /** the colour a mesh goes back to when it stops being selected */
    const SELECTED = new THREE.Color(0x1f7ae0);

    const rebuildMeshes = () => {
      for (const child of [...meshGroup.children]) {
        meshGroup.remove(child);
        if (child instanceof THREE.Mesh)
          (child.geometry as THREE.BufferGeometry).dispose();
      }
      for (const entity of session.doc.all()) {
        if (!isMeshable(entity) || !isEntityVisible(session.doc, entity))
          continue;
        const mesh3d = entity.toMesh('medium');
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute(
          'position',
          new THREE.Float32BufferAttribute([...mesh3d.positions], 3),
        );
        geometry.setIndex([...mesh3d.indices]);
        geometry.computeVertexNormals();
        const mesh = new THREE.Mesh(geometry, materialFor(entity.type));
        // what the raycaster hands back is a Mesh; this is how it becomes an
        // entity again without a second lookup structure to keep in step
        mesh.userData['entityId'] = entity.id;
        meshGroup.add(mesh);
      }
      paintSelection();
    };

    /**
     * Selection is shown by swapping the MATERIAL, not by tinting the shared
     * one — the kind materials are shared by every mesh of that kind, so
     * colouring one in place would light up every wall in the building.
     */
    const selectedMaterial = new THREE.MeshStandardMaterial({
      color: SELECTED,
      side: THREE.DoubleSide,
      roughness: 0.6,
    });
    function paintSelection() {
      const chosen = new Set(session.selection.list() as string[]);
      for (const child of meshGroup.children) {
        if (!(child instanceof THREE.Mesh)) continue;
        const id = child.userData['entityId'] as string | undefined;
        child.material =
          id && chosen.has(id)
            ? selectedMaterial
            : materialFor(
                (session.doc.get(id as EntityId)?.type ?? 'line') as string,
              );
      }
    }

    /** where the camera is gliding to, or null when it is where it belongs */
    let flight: {
      readonly from: THREE.Vector3;
      readonly to: THREE.Vector3;
      readonly look: THREE.Vector3;
      readonly was: THREE.Vector3;
      readonly start: number;
    } | null = null;

    /**
     * Frame one object, or the whole model when nothing is picked.
     *
     * The distance comes from the bounding SPHERE and the camera's own field of
     * view, which is the standard way and needs no numbers invented here: a
     * sphere of radius r fills a fov of θ at r / sin(θ/2). The direction is
     * kept — the camera slides along the line it is already on rather than
     * jumping to some canonical corner, so a view somebody has orbited into
     * stays theirs.
     */
    const frame = (box: THREE.Box3) => {
      if (box.isEmpty()) return;
      const sphere = box.getBoundingSphere(new THREE.Sphere());
      const fov = (camera.fov * Math.PI) / 180;
      const distance = (sphere.radius || 1) / Math.sin(fov / 2);
      const direction = camera.position
        .clone()
        .sub(controls.target)
        .normalize();
      flight = {
        from: camera.position.clone(),
        to: sphere.center
          .clone()
          .add(direction.multiplyScalar(Math.max(distance, 1.5))),
        look: sphere.center.clone(),
        was: controls.target.clone(),
        start: performance.now(),
      };
    };

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    /** where the press started, so an orbit drag is not read as a tap */
    let pressed: { x: number; y: number } | null = null;

    const onPointerDown = (event: PointerEvent) => {
      pressed = { x: event.clientX, y: event.clientY };
    };
    const onPointerUp = (event: PointerEvent) => {
      const from = pressed;
      pressed = null;
      // a drag is how the camera is moved; only a press that stayed put is a
      // choice about a shape
      if (
        !from ||
        Math.hypot(event.clientX - from.x, event.clientY - from.y) > 6
      ) {
        return;
      }
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(meshGroup.children, false)[0];
      const id = hit?.object.userData['entityId'] as EntityId | undefined;
      session.selection.clear();
      if (!id) {
        // tapping past everything frames the whole model again, which is the
        // way back when an orbit has left the building off screen
        frame(new THREE.Box3().setFromObject(meshGroup));
        return;
      }
      session.selection.add(id);
      frame(new THREE.Box3().setFromObject(hit.object));
    };
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointerup', onPointerUp);

    const unsubscribe = session.doc.events.on('change', rebuildMeshes);
    const unwatchSelection = session.selection.events.on(
      'changed',
      paintSelection,
    );
    rebuildMeshes();
    // open looking at whatever is there, rather than at the origin, which a
    // plan drawn away from it never reaches
    frame(new THREE.Box3().setFromObject(meshGroup));

    const resize = () => {
      const { clientWidth, clientHeight } = container;
      renderer.setSize(clientWidth, clientHeight);
      camera.aspect = clientWidth / Math.max(1, clientHeight);
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);

    let raf = 0;
    const loop = () => {
      if (flight) {
        const t = Math.min(1, (performance.now() - flight.start) / FOCUS_MS);
        const k = ease(t);
        camera.position.lerpVectors(flight.from, flight.to, k);
        controls.target.lerpVectors(flight.was, flight.look, k);
        if (t >= 1) flight = null;
      }
      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(loop);
    };
    loop();

    return () => {
      cancelAnimationFrame(raf);
      unsubscribe();
      unwatchSelection();
      observer.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      controls.dispose();
      disposeMaterials();
      selectedMaterial.dispose();
      ground.geometry.dispose();
      (ground.material as THREE.Material).dispose();
      renderer.dispose();
      container.removeChild(renderer.domElement);
    };
  }, [session]);

  return <div className="viewport" ref={containerRef} />;
}
