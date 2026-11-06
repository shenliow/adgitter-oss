// jsdom has no ResizeObserver, but Svelte 5 implements `bind:clientWidth`
// (used by MetroGraph to centre the graph) via ResizeObserver. Provide a no-op
// stub so components that observe size can mount in the test environment.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

if (!("ResizeObserver" in globalThis)) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).ResizeObserver = ResizeObserverStub;
}
