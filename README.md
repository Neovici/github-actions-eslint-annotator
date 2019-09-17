# github-actions-eslint-annotator
ESLint checker and annotator for Github Actions.
Uses eslint, eslint CLI to run in a Github Actions environment and create a new Check for ESLint.
If errors are found, these are annotated in the "Files Changed" tab.

## Usage

In your project:

`npm install --save-dev @neovici/github-actions-eslint-annotator`

In your Github Actions workflow:

```yaml
    - name: ESLint
      run: npx github-actions-eslint-annotator
      env:
        GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        PARTIAL_LINTING: true # default: false, only works on PRs
```

## Example output

![Image of sample annotation](https://user-images.githubusercontent.com/960553/64773010-e5718480-d551-11e9-8bea-fd41d97d8aad.png)

## Credits

Based on https://github.com/gimenete/eslint-action
