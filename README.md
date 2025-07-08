# spotify-tokener

`spotify-tokener` is a utility designed to generate Spotify access tokens, primarily for use with the `lavasrc` plugin.

## Features

- Generates Spotify access tokens.
- Designed for seamless integration with the `lavasrc` plugin.

## Installation

To get started with `spotify-tokener`, follow these steps:

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/appujet/spotify-tokener.git
    cd spotify-tokener
    ```

2.  **Install dependencies:**
    This project uses [Bun](https://bun.sh) as its JavaScript runtime and package manager. If you don't have Bun installed, you can find installation instructions on their official website.

    ```bash
    bun install
    ```

3.  **Download Playwright binaries:**
    `spotify-tokener` utilizes Playwright for browser automation. Download the necessary binaries for your platform:

    ```bash
    npx playwright install
    ```

## Usage

To run the `spotify-tokener` and generate a token:

```bash
bun run index.ts
```
