# Civitas

ElectionCord Civitas desktop source, California data, and local release artifacts.

Develop with `npm ci` and `npm start`. Run `npm test` for editor unit tests and `npm run test:smoke` for the isolated-profile Electron smoke test. Build Mac packages with `npm run dist:mac`.

The runnable source was recovered from the packaged Windows app and consolidated from the previous Mac project. The original project source and Git history are backed up locally under `archives/legacy-project/`.

## Folder layout

```text
civitas/
├── releases/
│   ├── macos/1.0.0/          # Apple Silicon (arm64) and Intel (x64) disk images
│   └── windows/0.0.1/        # Packaged Windows ZIP
├── builds/
│   └── windows/win-unpacked/ # Complete extracted Windows application
└── archives/
    └── source/0.0.1/
        ├── civitas-0.0.1.tar.gz
        ├── civitas-0.0.1.zip
        └── extracted/
            ├── civitas-0.0.1/
            └── civitas-0.0.1-copy-2/
```

## Working with these files

- Installers and release downloads belong in `releases/<platform>/<version>/`.
- Keep the entire `builds/windows/win-unpacked/` directory together. Its executable, DLLs, locales, and resources depend on their relative locations. Bundled web assets and election data are under `resources/web/`; the packaged Electron app is `resources/app.asar`.
- The source ZIP, tarball, and both extracted copies contain only the original README. They do not provide the application source; the runnable application is now in `main.js` and `web/`. The second extracted copy was renamed from `civitas-0.0.1 2` to `civitas-0.0.1-copy-2`.
- Versions above follow the downloaded filenames; Windows and macOS downloads carry different version numbers.

Release binaries, unpacked builds, and archived downloads are kept locally and ignored by Git. All original downloads and extracted files have been preserved.
