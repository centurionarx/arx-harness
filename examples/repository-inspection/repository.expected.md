## GitHub settings without a registered workspace

- region "GitHub":
  - heading "GitHub" [level=2]
  - button "Refresh"
  - status: Not configured. The operator must choose credential storage and isolation before a PAT can be accepted.
  - button "Connect with PAT" [disabled]

## Before selection

- region "Repository":
  - region "GitHub":
    - strong: GitHub
    - button "Refresh"
    - status: Not configured. The operator must choose credential storage and isolation before a PAT can be accepted.
    - button "Configure GitHub"
    - text: Workspace
    - combobox "Workspace":
      - option "Choose explicitly" [selected]
      - option "Inspection example"
    - text: Repo
    - combobox "Repo" [disabled]:
      - option "Choose explicitly" [selected]
    - list
    - button "Load more" [disabled]
  - strong: Repository
  - button "Refresh" [disabled]
  - combobox "Workspace":
    - option "Select a workspace" [selected]
    - option "Inspection example"
  - paragraph: Select a workspace to inspect its repository.
  - status: Repository data is stale. Refresh to continue.

## Selected repository

- region "Repository":
  - region "GitHub":
    - strong: GitHub
    - button "Refresh"
    - status: Not configured. The operator must choose credential storage and isolation before a PAT can be accepted.
    - button "Configure GitHub"
    - text: Workspace
    - combobox "Workspace":
      - option "Choose explicitly"
      - option "Inspection example" [selected]
    - text: Repo
    - combobox "Repo" [disabled]:
      - option "Choose explicitly" [selected]
    - list
    - button "Load more" [disabled]
  - strong: Repository
  - button "Refresh"
  - combobox "Workspace":
    - option "Select a workspace"
    - option "Inspection example" [selected]
  - strong: Inspection example
  - text: inspection
  - code: 50a8a56553c6645a2da1e1596832eee5c773c8a0
  - text: {{cwd}}/inspection
  - heading "Prepared (1)" [level=3]
  - 'button "Prepared: example.txt"':
    - code: MM
    - text: example.txt
  - heading "Modified (1)" [level=3]
  - 'button "Modified: example.txt"':
    - code: MM
    - text: example.txt
  - heading "New (0)" [level=3]
  - heading "Conflicts (0)" [level=3]

## Prepared comparison

- dialog "Read-only comparison":
  - heading "Read-only comparison" [level=2]
  - button "Close"
  - paragraph: example.txt · Prepared
  - text: diff --git a/example.txt b/example.txt index 690d712..fedd4e6 100644 --- a/example.txt +++ b/example.txt @@ -1 +1 @@ -base <tag> & value +prepared <script> & value

## Modified comparison

- dialog "Read-only comparison":
  - heading "Read-only comparison" [level=2]
  - button "Close"
  - paragraph: example.txt · Modified
  - text: diff --git a/example.txt b/example.txt index fedd4e6..d6c0bb2 100644 --- a/example.txt +++ b/example.txt @@ -1 +1 @@ -prepared <script> & value +modified <img src=x onerror=alert(1)> & value
