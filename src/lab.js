// Lab switches. Everything in the page that exists only for look development, measurement or the lab harness is read
// through this file, and only when the address carries ?lab=1. Without it a deep link cannot drop a pass, move the
// camera off its presets or reach the renderer from the console (review finding V42).
export const qs = new URLSearchParams(location.search);
export const LAB = qs.get('lab') === '1';
// a lab-only query parameter: null unless ?lab=1
export const labQ = (name) => (LAB ? qs.get(name) : null);
