/** Three.js counterparts of the Viewer surface and spatial-accent colors. */
export const SCENE_PALETTE = {
  light: {
    background: 0xf5f5f5,
    gridMajor: 0xc4c8ce,
    gridMinor: 0xe0e2e6,
    model: 0xc4c8cc,
    edges: 0x242424,
    spatial: 0x3979e3,
  },
  dark: {
    background: 0x131316,
    gridMajor: 0x30333a,
    gridMinor: 0x22252b,
    model: 0x8b9096,
    edges: 0xd6d6dc,
    spatial: 0x78aaff,
  },
} as const;
