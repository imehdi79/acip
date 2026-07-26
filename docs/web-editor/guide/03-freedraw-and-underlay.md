# Free draw & underlay

[← Guide index](README.md)

Two fast ways to get a plan into the app without placing every wall by hand:
sketch it freehand, or trace over a photo/scan of an existing drawing.

## Free draw (sketch → walls)

The **Free draw** tool lets you rough out a layout with a pen and have the app
turn it into real walls.

1. Start it from the **New → Free draw** card, or pick the pencil in the tool
   palette.
2. **Draw** your walls as freehand strokes on the canvas (two-finger pan/zoom on
   touch). A floating control shows how many strokes you've drawn.
3. Use **Undo** to drop the last stroke, or **Cancel** to leave without drawing.
4. Press **Done**. The strokes are **recognized into straight walls** in a
   single undo step, typed to the current wall assembly, then selected and framed
   so you can immediately set sizes.

After recognition each new wall gets a floating **length chip** — type the real
length to correct the rough sketch. This is the "draw loose, then dimension"
flow: get the shape down fast, then make it exact.

## Underlay — trace over a plan image

An **underlay** is a reference image (a photo, a PDF export, an old drawing)
shown *under* your model so you can trace it. It's presentation only — it isn't
part of the saved document, and your drawn model stays the single source of
truth.

### Load it
Click **Underlay** in the top bar and pick an image file. A floating **Underlay
card** appears over the canvas with these controls:

| Control | What it does |
| --- | --- |
| **Opacity** slider | Fades the image so your linework reads over it. |
| **Calibrate** (ruler icon) | Sets the real-world scale — see below. |
| **Trace** (scan icon) | Auto-draws walls from a region — see below. |
| **✕** | Removes the underlay. |

### Calibrate the scale
The image comes in at an arbitrary size. Click **Calibrate**, then click **two
points a known distance apart** on the image (say, a dimensioned wall). Enter
the real distance and the underlay is scaled so 1 m on the image equals 1 m in
the model. Do this before tracing so everything comes out at true size.

### Trace a region
Click **Trace**, then mark a region on the image; the app reads the walls it
sees there and draws them for you. Trace room by room, then clean up with the
[drawing tools](02-drawing-tools.md). (Tracing uses the AI assistant, so it
needs the editor server configured — see [AI assistant](08-ai-assistant.md).)

---

Next: [Rooms & finishes →](04-rooms-and-finishes.md)
