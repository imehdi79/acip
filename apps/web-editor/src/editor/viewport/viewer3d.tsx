import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { isMeshable } from '@acip/editor-core';
import { useSession } from '../session-context';

/**
 * Read-only 3D view: derived meshes in, pixels out. All Three.js code stays in
 * this file so the planned packages/viewer-3d extraction is a file move.
 * World convention: plan is XY, Z is up.
 */
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
    scene.background = new THREE.Color(0x1b1e23);

    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 2000);
    camera.up.set(0, 0, 1);
    camera.position.set(18, -18, 14);
    camera.lookAt(0, 0, 0);

    // GridHelper lies in XZ by default; rotate into our XY ground plane
    const grid = new THREE.GridHelper(50, 50, 0x3a4048, 0x262b31);
    grid.rotation.x = Math.PI / 2;
    scene.add(grid);
    scene.add(new THREE.AxesHelper(2));
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.2);
    sun.position.set(20, -10, 30);
    scene.add(sun);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    const meshGroup = new THREE.Group();
    scene.add(meshGroup);
    const material = new THREE.MeshStandardMaterial({
      color: 0x8fa3b8,
      side: THREE.DoubleSide,
    });

    const rebuildMeshes = () => {
      for (const child of [...meshGroup.children]) {
        meshGroup.remove(child);
        if (child instanceof THREE.Mesh) (child.geometry as THREE.BufferGeometry).dispose();
      }
      for (const entity of session.doc.all()) {
        if (!isMeshable(entity)) continue;
        const mesh3d = entity.toMesh('medium');
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute(
          'position',
          new THREE.Float32BufferAttribute([...mesh3d.positions], 3),
        );
        geometry.setIndex([...mesh3d.indices]);
        geometry.computeVertexNormals();
        meshGroup.add(new THREE.Mesh(geometry, material));
      }
    };
    const unsubscribe = session.doc.events.on('change', rebuildMeshes);
    rebuildMeshes();

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
      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(loop);
    };
    loop();

    return () => {
      cancelAnimationFrame(raf);
      unsubscribe();
      observer.disconnect();
      controls.dispose();
      renderer.dispose();
      container.removeChild(renderer.domElement);
    };
  }, [session]);

  return <div className="viewport" ref={containerRef} />;
}
