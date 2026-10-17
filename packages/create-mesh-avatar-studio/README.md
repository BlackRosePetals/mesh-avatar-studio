# create-mesh-avatar-studio

Set up [Mesh Avatar Studio](https://github.com/shinshin86/mesh-avatar-studio) in one command.

![A Mesh Avatar Studio avatar following a face through a webcam](https://raw.githubusercontent.com/shinshin86/mesh-avatar-studio/main/docs/images/face-tracking.gif)

```sh
npx create-mesh-avatar-studio
```

It downloads the repository with Git into `mesh-avatar-studio/` (or the folder you name),
installs its packages and checks the tools it needs. Then start the editor:

```sh
cd mesh-avatar-studio
npm run dev
```

Requires Node.js 22.17+ and Git.

## Options

```sh
npx create-mesh-avatar-studio my-avatars   # choose the folder
npx create-mesh-avatar-studio --lang ja    # messages in Japanese (default follows your locale)
```

## What the check reports

The same check runs any time with `npm run doctor` inside the folder.

| Tool | Needed for |
|---|---|
| Node.js 22.17+ and the installed packages | The editor and the Live page. Missing ones are errors. |
| uv and Python 3.10+ | Rebuilding layers and creating avatars. Missing ones are warnings. |
| Playwright Chromium | Rendering the motion review when an agent creates an avatar or imports drawn eyes and mouths. A missing browser is a warning. |

To try an avatar without installing anything, open the
[Player](https://shinshin86.github.io/mesh-avatar-studio/play/) in Chrome or Edge.

## License

MIT. See [LICENSE](./LICENSE).
