/**
 * Built-in avatar presets (original geometric artwork; no uploads, so no user
 * images are stored or served). Shared by the server (validation) and the UI.
 */
export const AVATAR_PRESETS = [
  { id: 'gold-diamond', label: 'Gold diamond', shape: 'diamond', from: '#e9cf8f', to: '#9c7a35' },
  { id: 'jade-circle', label: 'Jade circle', shape: 'circle', from: '#8fd6b4', to: '#2f7d5c' },
  { id: 'ruby-triangle', label: 'Ruby triangle', shape: 'triangle', from: '#f0a39b', to: '#a53a32' },
  { id: 'sapphire-square', label: 'Sapphire square', shape: 'square', from: '#9fc3f2', to: '#33609e' },
  { id: 'amethyst-star', label: 'Amethyst star', shape: 'star', from: '#cdb2f2', to: '#6b4aa3' },
  { id: 'silver-wave', label: 'Silver wave', shape: 'wave', from: '#e3e6ec', to: '#7c8494' },
  { id: 'copper-hexagon', label: 'Copper hexagon', shape: 'hexagon', from: '#f2c39b', to: '#9a5a2c' },
  { id: 'onyx-moon', label: 'Onyx moon', shape: 'moon', from: '#c9ccd4', to: '#3b3f49' },
] as const;

export type AvatarPreset = (typeof AVATAR_PRESETS)[number];
export type AvatarId = AvatarPreset['id'];

export const AVATAR_IDS = AVATAR_PRESETS.map((a) => a.id) as [AvatarId, ...AvatarId[]];

export function avatarPreset(id: string | null | undefined): AvatarPreset | null {
  return AVATAR_PRESETS.find((a) => a.id === id) ?? null;
}
