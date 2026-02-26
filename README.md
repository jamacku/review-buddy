<!-- markdownlint-disable MD033 MD041 -->
<p align="center">
  <img src="https://github.com/redhat-plumbers-in-action/team/blob/fc2271a15d805c7120ce77ea8c50d413b9a95586/members/blue-plumber.png" width="100" />
  <h1 align="center">Review Buddy</h1>
</p>

[![GitHub Marketplace][market-status]][market] [![Lint Code Base][linter-status]][linter] [![Unit Tests][test-status]][test] [![CodeQL][codeql-status]][codeql] [![Check dist/][check-dist-status]][check-dist]

[![codecov][codecov-status]][codecov]

<!-- Status links -->

[market]: https://github.com/marketplace/actions/review-buddy
[market-status]: https://img.shields.io/badge/Marketplace-Review%20Buddy-blue.svg?colorA=24292e&colorB=0366d6&style=flat&longCache=true&logo=data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAA4AAAAOCAYAAAAfSC3RAAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAM6wAADOsB5dZE0gAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAAERSURBVCiRhZG/SsMxFEZPfsVJ61jbxaF0cRQRcRJ9hlYn30IHN/+9iquDCOIsblIrOjqKgy5aKoJQj4O3EEtbPwhJbr6Te28CmdSKeqzeqr0YbfVIrTBKakvtOl5dtTkK+v4HfA9PEyBFCY9AGVgCBLaBp1jPAyfAJ/AAdIEG0dNAiyP7+K1qIfMdonZic6+WJoBJvQlvuwDqcXadUuqPA1NKAlexbRTAIMvMOCjTbMwl1LtI/6KWJ5Q6rT6Ht1MA58AX8Apcqqt5r2qhrgAXQC3CZ6i1+KMd9TRu3MvA3aH/fFPnBodb6oe6HM8+lYHrGdRXW8M9bMZtPXUji69lmf5Cmamq7quNLFZXD9Rq7v0Bpc1o/tp0fisAAAAASUVORK5CYII=

[linter]: https://github.com/redhat-plumbers-in-action/review-buddy/actions/workflows/lint.yml
[linter-status]: https://github.com/redhat-plumbers-in-action/review-buddy/actions/workflows/lint.yml/badge.svg

[test]: https://github.com/redhat-plumbers-in-action/review-buddy/actions/workflows/unit-tests.yml
[test-status]: https://github.com/redhat-plumbers-in-action/review-buddy/actions/workflows/unit-tests.yml/badge.svg

[codeql]: https://github.com/redhat-plumbers-in-action/review-buddy/actions/workflows/codeql-analysis.yml
[codeql-status]: https://github.com/redhat-plumbers-in-action/review-buddy/actions/workflows/codeql-analysis.yml/badge.svg

[check-dist]: https://github.com/redhat-plumbers-in-action/review-buddy/actions/workflows/check-dist.yml
[check-dist-status]: https://github.com/redhat-plumbers-in-action/review-buddy/actions/workflows/check-dist.yml/badge.svg

[codecov]: https://codecov.io/gh/redhat-plumbers-in-action/review-buddy
[codecov-status]: https://codecov.io/gh/redhat-plumbers-in-action/review-buddy/branch/main/graph/badge.svg

<!-- -->

Review Buddy is a GitHub Action that analyzes CI workflow failures alongside Pull Request code changes using Google Gemini. It acts as an AI-powered second reviewer, posting inline review comments that identify which code changes likely caused the CI failures and suggesting fixes.

## Features

* Analyze failed CI job logs in the context of Pull Request code changes
* Post inline review comments on the specific lines that caused failures
* Suggest fixes using GitHub's suggestion syntax for one-click apply
* Detect infrastructure flakes and distinguish them from code-related failures
* Configurable Gemini model and review event type

## Usage

To set up Review Buddy, we need two files:

* Workflow that captures Pull Request metadata (number and commit metadata) and uploads this data as an artifact
* Workflow that runs on `workflow_run` trigger, downloads artifact, and runs `review-buddy` GitHub Action

> [!NOTE]
>
> Setup is complicated due to GitHub [permissions on `GITHUB_TOKEN`](https://docs.github.com/en/actions/security-guides/automatic-token-authentication#permissions-for-the-github_token). When used in workflow executed from fork it has `read-only` permissions. By using the `workflow_run` trigger we are able to [safely overcome this limitation](https://securitylab.github.com/research/github-actions-preventing-pwn-requests/) and it allows us to read workflow logs and post review comments on Pull Requests.

```yml
name: Gather Pull Request Metadata
on:
  pull_request:
    types: [ opened, reopened, synchronize ]
    branches: [ main ]

permissions:
  contents: read

jobs:
  gather-metadata:
    runs-on: ubuntu-latest

    steps:
      - name: Repository checkout
        uses: actions/checkout@v4

      - id: Metadata
        name: Gather Pull Request Metadata
        uses: redhat-plumbers-in-action/gather-pull-request-metadata@v1

      - name: Upload artifact with gathered metadata
        uses: actions/upload-artifact@v4
        with:
          name: pr-metadata
          path: ${{ steps.Metadata.outputs.metadata-file }}
```

```yml
name: Review Buddy
on:
  workflow_run:
    workflows: [ Gather Pull Request Metadata ]
    types:
      - completed

permissions:
  contents: read

jobs:
  download-metadata:
    if: >
      github.event.workflow_run.event == 'pull_request' &&
      github.event.workflow_run.conclusion == 'failure'
    runs-on: ubuntu-latest

    outputs:
      pr-metadata: ${{ steps.Artifact.outputs.pr-metadata-json }}

    steps:
      - id: Artifact
        name: Download Artifact
        uses: redhat-plumbers-in-action/download-artifact@v1
        with:
          name: pr-metadata

  review-buddy:
    needs: [ download-metadata ]
    runs-on: ubuntu-latest

    permissions:
      # required for reading workflow logs
      actions: read
      # required for posting review comments
      pull-requests: write

    steps:
      - name: Review Buddy
        uses: redhat-plumbers-in-action/review-buddy@v1
        with:
          pr-metadata: ${{ needs.download-metadata.outputs.pr-metadata }}
          gemini-api-key: ${{ secrets.GEMINI_API_KEY }}
          token: ${{ secrets.GITHUB_TOKEN }}
```

### Real-life examples

* [source-git-automation](https://github.com/redhat-plumbers-in-action/source-git-automation) - Used as part of the source-git automation pipeline alongside other validation actions

## Configuration options

Action currently accepts the following options:

```yml
# ...

- uses: redhat-plumbers-in-action/review-buddy@v1
  with:
    pr-metadata:   <pr-metadata.json>
    token:         <GitHub token or PAT>
    gemini-api-key: <Gemini API key>
    model:         <Gemini model identifier>
    review-event:  <COMMENT or REQUEST_CHANGES>

# ...
```

### pr-metadata

Stringified JSON Pull Request metadata provided by GitHub Action [`redhat-plumbers-in-action/gather-pull-request-metadata`](https://github.com/redhat-plumbers-in-action/gather-pull-request-metadata).

Pull Request metadata has the following format: [metadata format](https://github.com/redhat-plumbers-in-action/gather-pull-request-metadata#metadata)

* default value: `undefined`
* requirements: `required`

### token

GitHub token or PAT is used for reading workflow logs and posting review comments on Pull Request.

```yml
# required permissions
permissions:
  actions: read
  pull-requests: write
```

* default value: `undefined`
* requirements: `required`
* recomended value: `secrets.GITHUB_TOKEN`

### gemini-api-key

Google Gemini API key used for AI-powered analysis of CI failures. You can obtain an API key from [Google AI Studio](https://aistudio.google.com/apikey).

* default value: `undefined`
* requirements: `required`
* recomended value: `secrets.GEMINI_API_KEY`

### model

Gemini model identifier to use for analysis. See [available models](https://ai.google.dev/gemini-api/docs/models) for a list of supported models.

* default value: `gemini-2.5-flash`
* requirements: `optional`

### review-event

The review event type to use when posting the review. Use `COMMENT` for non-blocking reviews or `REQUEST_CHANGES` to block merging until the issues are resolved.

* default value: `COMMENT`
* requirements: `optional`

## Outputs

### `status`

Markdown-formatted status message summarizing the AI review results. Designed for use with [`redhat-plumbers-in-action/issue-commentator`](https://github.com/redhat-plumbers-in-action/issue-commentator) to post a consolidated status comment on the Pull Request.

## Limitations

* Log analysis quality depends on the Gemini model used and the clarity of CI error output
* Very large diffs or logs may be truncated to fit within model context limits
* AI-generated review comments may occasionally suggest incorrect fixes; always verify suggestions before applying
* The action requires a Google Gemini API key, which may incur usage costs depending on the model and volume
