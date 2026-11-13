// The one accessor through which the features of this build read fiber centre-lines out of the base: the
// control-point texture on the GPU and its mirror on the CPU. The burst replay rides its sparks along these lines
// and frames the camera from them. If the layout or the renderer changes how control points are stored, this is
// the only function to adjust.
//
//   tex     RGBA32F texture, `cpn` control points per fiber (uniform cubic B-spline, xyz = world position).
//           Fiber i sits in column floor(i / rows), row i % rows; a column is `cpn` texels wide.
//   point   world position at u in [0, 1] on fiber i, the same spline the vertex shader evaluates.
//   fiber   the layout's record for fiber i: { skill, muscle, len, radius, closed }.
export function fiberLines(renderer, anat) {
  return {
    tex: renderer.cpTex, cpn: anat.CPN, rows: renderer.rows, count: anat.count,
    point: (i, u) => anat.point(i, u).p,
    fiber: (i) => anat.fibers[i],
  };
}
