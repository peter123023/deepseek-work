# build/

electron-builder build resources. The `icon.png` referenced by the packaging
config must be committed here before a real installer can be produced; a
placeholder is deliberately absent so a build fails loudly rather than shipping
an empty icon.
