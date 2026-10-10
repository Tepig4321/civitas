# Civitas

ElectionCord Civitas desktop source, California data and local release artifacts.

## Develop and verify

Use `npm ci` and `npm start`. Run `npm test`, `npm run test:smoke` and `npm run test:editor`. Electron checks use temporary profiles and do not touch saved user maps. See [the editor guide](docs/EDITOR.md) for tools, history, migration and data methods.

Rebuild the geodata with Python 3.14:

```sh
python3 -m venv .venv
.venv/bin/pip install -r scripts/geodata-requirements.txt
npm run data:fetch
npm run data:build
npm run data:validate
```

Downloaded inputs and intermediate tables live in `.cache/geodata/`. Bundled output lives in `web/data/block-v1/`, including source URLs/checksums and county allocation audits. The builder resumes counties matching its build revision. Keep an incomplete dataset out of release packages; the final manifest must contain all 58 counties and 39,538,223 original Census residents.

## Package

`npm run dist:mac` builds Apple Silicon and Intel DMG/ZIP files. `npm run dist:win` builds a Windows x64 ZIP. Artifacts are local and unsigned/ad-hoc signed; these commands do not publish.

## Folder layout

- `main.js`, `web/`: runnable Electron app and bundled data.
- `scripts/`, `tests/`, `docs/`: build pipeline, checks and editor documentation.
- `dist/`: new build artifacts and verification screenshots.
- `releases/<platform>/<version>/`: preserved release downloads.
- `builds/windows/win-unpacked/`: original complete extracted Windows app.
- `archives/source/0.0.1/`: original source downloads, which contained only README files.
- `archives/legacy-project/`: preserved sibling-project source and Git history, unique build artifacts and checksum inventory.

The recovered runnable source has been consolidated here. Release binaries, archived downloads, build artifacts, dependencies and caches are ignored by Git. Original downloads and unique artifacts have been preserved.
