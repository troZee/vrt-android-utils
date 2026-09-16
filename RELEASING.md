# Releasing

## One-time npm setup

1. Confirm that the `vrt-android-utils` name is still available on npm.
2. Sign in to npm with an account that has two-factor authentication enabled.
3. Publish `0.1.0` manually from a clean checkout with `npm publish --access public`.
4. In the npm package settings, add a GitHub Actions trusted publisher for:
   - organization or user: `troZee`
   - repository: `vrt-android-utils`
   - workflow: `release.yml`
5. Protect release tags in GitHub.

Trusted publishing requires no long-lived npm token. The release workflow requests an OIDC identity token and npm adds provenance automatically for the public package and repository.

## Preflight

Use Node.js 22.14 or newer, npm 11.5.1 or newer, and Bun 1.4 or newer:

```sh
bun install --frozen-lockfile
bun run check
npm pack --dry-run
git status --short
```

The working tree must be clean. Inspect the dry-run file list and confirm that it contains only the runtime source, configuration example and schema, package metadata, README, and license.

## Release

1. Update `version` in `package.json` according to semantic versioning.
2. Update user-facing documentation and configuration schema when applicable.
3. Run the preflight commands.
4. Commit the version change and create a `v<version>` tag.
5. Push the commit and tag.
6. Publish a GitHub Release for the tag.

Publishing the GitHub Release triggers `.github/workflows/release.yml`. The workflow verifies that the tag matches `package.json`, repeats every check, and publishes through npm trusted publishing.

Do not reuse a published version. If publishing fails after npm accepts the package, increment the version before retrying.
