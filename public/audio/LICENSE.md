# Aurovane sound effects — origin and licence

Every file in this directory is an **original work created for Aurovane**. Each
one is synthesised by the project's own code in `scripts/audio/`:

- `synth.ts` holds oscillators, seeded noise, biquad filters and envelopes;
- `sounds.ts` holds one recipe per file.

To regenerate the files, run `npm run audio:generate`.

## What the files contain

- **No recordings.** There are no samples, no sound-library content and no
  third-party material of any kind.
- **No real casino audio.** No casino, table or machine recording was used or
  imitated from a recording.
- **Deterministic.** The same recipes always produce byte-identical files, so
  the SHA-256 checksums in `manifest.json` prove where each file came from.
  `npm run audio:generate -- --check` and the unit test
  `tests/unit/audio-assets.test.ts` fail if a committed file no longer matches
  its recipe.

## Licence

The files carry the same licence as the rest of this repository: proprietary,
`"license": "UNLICENSED"` in `package.json`. The repository owner holds every
right in them and may relicense them, for example under CC0 1.0, without
anyone else's permission.

## Format

All files use the same format:

| Property | Value |
|---|---|
| Container | WAV |
| Encoding | PCM, 16-bit |
| Channels | Mono |
| Sample rate | 22,050 Hz |

The longest file (a seamless ambience loop) is about 6 s; the whole set is about 1.6 MiB. A browser downloads
only the files of the game being played.
