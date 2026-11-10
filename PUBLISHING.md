# Publishing `dsh-finesse-visualizer`

The GitHub half is published under `darkneu/dsh-finesse-visualizer`; this file
stays as the maintainer guide for future releases. npm is still pending (this
machine had no npm login when the release was cut), and the catalog PR must wait
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
- The `v1.0.0` tag runs `.github/workflows/release.yml`. It packs the package and
  uploads `dsh-finesse-visualizer.tgz` as a release asset (the stable name the
  catalog points at). It does **not** publish to npm; that is a separate manual
  step, so a release never fails because npm credentials are absent.
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
  local build:              dist/dsh-finesse-visualizer-1.0.0.tgz
  SHA-256 (macOS):          4f78021e29390803ca7d0e6bdd05ca838c53a93ec82715c337ada825e2a67667
  GitHub release asset:     dsh-finesse-visualizer.tgz (v1.0.0)
  SHA-256 (CI, Linux):      3fa768be22c34a1d17be2a870c30cbfd69646829d7397cfb02464279a83a1d52
  ```

  The two hashes differ because pnpm records platform metadata while packing;
  both tarballs contain the same 37 files and package identity. Verify the
  published asset with `curl -sL .../dsh-finesse-visualizer.tgz | shasum -a 256`.
  `release/SHA256SUMS` carries both lines.

## Credential options

Either run steps 1–3 with your own GitHub/npm login, or authenticate this
machine and ask the agent to continue:

```sh
gh auth login          # GitHub CLI, if installed
npm login              # for npm publishing
```

Do not paste tokens into the chat; authenticate the tools instead.
