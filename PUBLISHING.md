# Publishing `dsh-finesse-visualizer`

The GitHub half is published under `darkneu/dsh-finesse-visualizer`; this file
stays as the maintainer guide for future releases. npm needs a separate login
(this machine had none when the release was cut), and the catalog PR must wait
until the repository is at least one day old.

## 1. GitHub repository and release

Create an empty public repository named `dsh-finesse-visualizer` under your
account, then:

```sh
git remote add origin https://github.com/darkneu/dsh-finesse-visualizer.git
git push -u origin main
git push origin v1.0.0
```

- Add the `dsh-plugin` topic to the repository (catalog requirement).
- The `v1.0.0` tag runs `.github/workflows/release.yml`. It packs the package,
  uploads `dsh-finesse-visualizer.tgz` as a release asset (the stable name the
  catalog points at) and then publishes to npm if the `NPM_TOKEN` secret exists.
- The repository must be at least one day old before the catalog PR; that is a
  catalog rule, not a technical one. Submit the entry after that window.

## 2. npm

The name `dsh-finesse-visualizer` was unclaimed at the time of writing.

```sh
pnpm login                     # or: npm login
pnpm publish --access public
# or from a packed tarball:
# pnpm publish ./dist/dsh-finesse-visualizer-1.0.0.tgz --access public
```

Verify:

```sh
npm view dsh-finesse-visualizer version
curl -s https://registry.npmjs.org/dsh-finesse-visualizer | head -c 200
```

There is no build step: `pnpm pack` ships `index.js`, `client.js`,
`python/render_finesse.py`, `assets/`, `locale/`, the patch and the icon as
listed in `files`.

## 3. Plugin catalog (DSH market)

The market reads `https://awesome-dsh-plugin.com/plugins.json`, generated from
one YAML file per plugin in `awesome-dsh-plugin/awesome-dsh-plugin`.

Open a PR that adds exactly one file:

`data/plugins/darkneu__dsh-finesse-visualizer.yml`

with the content of `release/catalog-entry.yml` (already filled in for
`darkneu`). Category
`ui`; the maintainer may refile it. The entry's `tarball` points at the
version-free release asset, so it does not rot on the next release.

## Verify the public install

```sh
dsh plugin --profile <profile> add dsh-finesse-visualizer
# or, without npm:
dsh plugin --profile <profile> add https://github.com/darkneu/dsh-finesse-visualizer/releases/latest/download/dsh-finesse-visualizer.tgz
```

Then refresh the Web page once: the left sidebar shows **Finesse 设计器**, and a
Finesse/KatScript message gets the visualization card at the end of its turn.

## What is already prepared here

- Package renamed from the private `@local/finesse-visualizer` to the public
  `dsh-finesse-visualizer`; the client module id matches the package name.
- `cordis.patch.yml` now names the entry by relative path (`./index.js`), so the
  bundle loads from npm, a tarball, or a local checkout regardless of the folder
  name.
- GPL-3.0 `LICENSE` and `NOTICE.md` (the component artwork comes from the
  GPL-3.0 Finesse-visualization project).
- `.github/workflows/release.yml`, `release/catalog-entry.yml`, this file.
- Local git repository with the initial commit and `v1.0.0` tag.
- A packed tarball in `dist/`:

  ```
  dist/dsh-finesse-visualizer-1.0.0.tgz
  SHA-256: 4f78021e29390803ca7d0e6bdd05ca838c53a93ec82715c337ada825e2a67667
  ```

  Verify with `shasum -a 256 dist/dsh-finesse-visualizer-1.0.0.tgz` (or
  `sha256sum`). `release/SHA256SUMS` carries the same line.

## Credential options

Either run steps 1–3 with your own GitHub/npm login, or authenticate this
machine and ask the agent to continue:

```sh
gh auth login          # GitHub CLI, if installed
npm login              # for npm publishing
```

Do not paste tokens into the chat; authenticate the tools instead.
