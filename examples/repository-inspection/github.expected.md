## GitHub settings without a selected workspace

- region "GitHub":
  - heading "GitHub" [level=2]
  - button "Refresh"
  - status: Disconnected
  - button "Connect with PAT"

## Private PAT prompt

- dialog "GitHub personal access token":
  - heading "GitHub personal access token" [level=2]
  - paragraph: Record mode stores the PAT on the server. It is not automatically model-visible, but host tools running under the same UID may read the credential storage. Choose operator isolation before submitting.
  - status: Waiting for authorization…
  - text: Enter your GitHub personal access token
  - textbox "Personal access token"
  - button "Submit" [disabled]
  - button "Cancel"

## Verified account without repository navigation

- region "GitHub":
  - heading "GitHub" [level=2]
  - button "Refresh"
  - status: Connected
  - paragraph: example-reader https://github.com/example-reader
  - button "Connect with PAT"

## First public metadata page

- region "GitHub repositories":
  - heading "GitHub repositories" [level=3]
  - button "Refresh repositories"
  - text: Workspace
  - combobox "Workspace":
    - option "Choose explicitly" [selected]
    - option "Retarget example"
    - option "Inspection example"
  - text: Repo
  - combobox "Repo":
    - option "Choose explicitly" [selected]
    - option "example-reader/first"
  - list:
    - listitem:
      - strong: example-reader/first
      - text: "Public Default branch: <img src=x onerror=alert(1)> & branch https://github.com/example-reader/first"
  - button "Load more"

## Explicit pairing in GitHub settings

- region "GitHub repositories":
  - heading "GitHub repositories" [level=3]
  - button "Refresh repositories"
  - text: Workspace
  - combobox "Workspace":
    - option "Choose explicitly"
    - option "Retarget example" [selected]
    - option "Inspection example"
  - text: Repo
  - combobox "Repo":
    - option "Choose explicitly"
    - option "example-reader/first"
    - option "example-reader/second" [selected]
  - paragraph: "Workspace: Retarget example · Repo: example-reader/second View-only association for the current selection; no saved binding, clone or Git writes."
  - list:
    - listitem:
      - strong: example-reader/first
      - text: "Public Default branch: <img src=x onerror=alert(1)> & branch https://github.com/example-reader/first"
    - listitem:
      - strong: example-reader/second
      - text: "Private Default branch: inspection https://github.com/example-reader/second"
  - button "Load more" [disabled]

## Pairing retargets the real Git owner

- region "Repository":
  - strong: Repository
  - button "Refresh"
  - combobox "Workspace":
    - option "Select a workspace"
    - option "Retarget example" [selected]
    - option "Inspection example"
  - strong: Retarget example
  - text: retarget
  - code: 310287d64e92d7b4837ef5e8fdf42c8650e8435b
  - text: {{cwd}}/retarget
  - heading "Prepared (1)" [level=3]
  - 'button "Prepared: second.txt"':
    - code: MM
    - text: second.txt
  - heading "Modified (1)" [level=3]
  - 'button "Modified: second.txt"':
    - code: MM
    - text: second.txt
  - heading "New (0)" [level=3]
  - heading "Conflicts (0)" [level=3]

## Rejected synthetic credential

- region "GitHub":
  - heading "GitHub" [level=2]
  - button "Refresh"
  - status: Disconnected
  - button "Connect with PAT"
