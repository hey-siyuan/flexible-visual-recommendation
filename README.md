# Flexible Visual Recommendation

**Visualizing the Imaginative**

Selecting preferred images from large collections of AI-generated content remains challenging, particularly in subjective and speculative contexts. Flexible Visual Recommendation helps creative practitioners explore these collections by connecting scores from a user-defined rubric to an interactive canvas.

Users define what matters in their design brief, choose a scoring dimension as the canvas axis, and compare images across the score range. They can inspect the visual evidence behind each model score and build a shortlist based on their own judgment. The included SuperFruit dataset illustrates the workflow with speculative fruit designs.

## Quick start

1. Install [Node.js](https://nodejs.org/en/download) (22.13 or later in the 22.x series, or 24 or later).
2. From this project's root directory, run:

   ```sh
   npm ci
   npm run dev
   ```

3. Open the address printed by Vite, usually [http://127.0.0.1:5173](http://127.0.0.1:5173), and choose a model provider.

## Choose a model

### Run a local model with Ollama

1. Install [Ollama](https://ollama.com/download) for macOS, Windows, or Linux. Open Ollama, or run `ollama serve` in a separate terminal if you installed only the CLI and the service is stopped.
2. Run `ollama pull qwen3-vl:4b` to download the example vision model.
3. Under **Model**, choose **Local Ollama**, click the refresh button, and select the installed model.

Live scoring was tested with Qwen3-VL 4B through local Ollama, with no API fees. The API connection was verified with simulated provider responses. To use a different local vision model, install it with `ollama pull <model-name>` and refresh the model picker. Local scoring runs on your computer and requires no API key.

On macOS, you can also run `./start.command` after installing dependencies. It uses a running Ollama service when available and otherwise starts the `ollama` executable on your PATH. Set `OLLAMA_BIN` to its path if you installed the executable somewhere else.

### Use a model API with your own key

1. Start the app with `npm run dev`. You can use API mode without installing Ollama.
2. Under **Model**, select **OpenAI**, **OpenRouter**, or **Custom compatible API**.
3. Paste your API key and enter the provider's exact model ID. Choose a model that supports both image input and JSON mode over Chat Completions. See the [OpenAI API reference](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create) or the [OpenRouter model catalog](https://openrouter.ai/models).

For a custom provider, set `COMPATIBLE_API_BASE_URL` before starting Vite. For example, on macOS or Linux:

```sh
COMPATIBLE_API_BASE_URL=https://your-provider.example/v1 npm run dev
```

In PowerShell, use `$env:COMPATIBLE_API_BASE_URL = "https://your-provider.example/v1"` before running `npm run dev`. The app appends `/chat/completions` to the base path. The endpoint must use HTTPS or run on loopback, and must accept a bearer key, image data URLs, and JSON mode.

API scoring sends the images, rubric, and optional design brief to the selected provider. Charges and rate limits depend on your provider and model. The app keeps your key in memory for the current page and clears it when you reload. Reports record the provider and model ID. The key is omitted from reports.

## Evaluate a batch

1. Enter an optional **Image concept** to give the model shared context, such as the audience, intended use, or design brief.
2. Under **Scoring dimensions**, define one to eight dimensions, each with its own name and prompt. Choose which dimension goes on the horizontal axis. The combined prompts can contain up to 10,000 characters.
3. Add JPEG, PNG, or WebP images up to 10 MB each and click **Execute Evaluation**. The progress indicator tracks the batch. Retries use the original provider, model, and rubric, with the key currently entered for that provider.
4. Hover over an image to enlarge it, or click it to see its scores and evidence. The profile uses a radar chart for three or more dimensions and score bars for one or two. Use **Mark as Selected** to shortlist an image.
5. Results automatically fit the available canvas when scoring finishes. Switching the axis or resizing the window fits the new layout again. Pinch or use the canvas controls to zoom, drag to pan, and choose **Fit all** to return to the complete overview. Use **Export Report** to save the batch settings, scores, evidence, ranks, layout, and shortlist as JSON. Export before reloading to retain the results.

### Try the included images

The [IV-SI-Dataset](./IV-SI-Dataset) folder contains 405 SuperFruit PNG images (about 387 MiB). For a quick first run, choose these three files and enter a brief such as “Explore imaginative fruit designs that still look recognizable and appetizing.”

- `1-P-1_20251112_105139.png`
- `2-P-1_20251112_105140.png`
- `LM-P-1_20251112_105138.png`

### Write a rubric

Use plain text for a single dimension score, or define criteria to score separately. For example, a poster review might use **Legibility** as a dimension with this prompt:

```text
Title hierarchy: (+) The title stands out at a glance; (−) Several elements compete with the title.
Text contrast: (+) Text is easy to distinguish from its background; (−) Low contrast or background detail obscures it.
```

For a dimension with recognized criteria, the model returns a 1–6 score and visible evidence for each criterion. The app takes their arithmetic mean, with equal weight for each criterion. For a free-text dimension, the model returns a single score and rationale. You can write the criteria in your preferred language. Try them on a small batch to check how the model interprets them.

### Read the canvas

The horizontal center of each card and its base side length increase linearly with the selected dimension's score on the 1–6 scale. At canvas widths of at least 1,400 pixels, side lengths range from 80 to 224 pixels before zoom; narrower canvases apply a common responsive scale. Vertical position is computed by the packing algorithm and carries no score. Images are placed in stable identifier order, using deterministic vertical offsets. A pairwise clearance proposes a location, then a rectangle-union check limits the combined overlap with all other thumbnails to 25% of each thumbnail's square area. A conflicting position moves down in 4-pixel steps until it passes. This conservative check keeps actual occlusion within the limit even when interaction changes drawing order; border glows and the separate score profile are outside the thumbnail-area calculation.

Drawing order has three tiers: the hovered, keyboard-focused, or inspected image is temporarily foremost; selected images appear above all ordinary images; ordinary images form the remaining tier. Within the selected and ordinary tiers, the sum of all dimension scores determines order, with higher totals in front. Stable identifiers break equal totals. Ending inspection restores the selected or ordinary tier; deselecting restores ordinary order once inspection ends. Hovered and selected cards grow in place toward the largest base size in the batch. When that enlargement would exceed the 25% overlap limit, the app reduces the enlargement while preserving the center and score. The rank uses the selected axis alone: one plus the number of successfully scored images with a strictly higher axis score. Equal scores share a rank.

**Fit all** uses the actual packed layout height, rather than a fixed zoom for a given image count. It fits both the full score axis and the vertical bounds, including space for enlargement, with 36 pixels for the tick strip and 64 pixels for the controls. More densely packed collections therefore start at a smaller zoom. This gives an overview of all thumbnails; it does not guarantee that every detail remains readable in a large collection. Zoom in to inspect details. Manual zoom is retained until the next completed scoring batch, axis change, viewport resize, or explicit **Fit all** action. Tick labels and vertical guide lines retain their screen-space size while their horizontal positions follow the zoomed score axis.

## Configuration

Pass environment variables to the process running Vite when you need to override these defaults.

| Variable | Default | Purpose |
| --- | --- | --- |
| `OLLAMA_DEFAULT_MODEL` | `qwen3-vl:4b` | Preferred model in the picker, if installed and vision-capable. |
| `OLLAMA_PORT` | `11434` | Port for the local Ollama service on `127.0.0.1`. If you change it, configure Ollama and its CLI to use the same address via `OLLAMA_HOST`. |
| `COMPATIBLE_API_BASE_URL` | Unset | Base URL for **Custom compatible API**. |

If the picker cannot find a model, check that Ollama is running, use `ollama list` to check what is installed, and refresh the picker. If scoring fails, retry the affected image and check the Ollama service logs if the error persists.

## Development

- `npm run lint` checks the source.
- `npm test` checks fitting, overlap unions, custom dimensions, and interaction layer priority.
- `npm run build` builds the frontend.
- `npm run preview` serves the built frontend together with the scoring API.

The React interface and score layout live in `src/`. The Vite middleware in `server/ollama.js` validates and routes scoring requests. The compatible API transport lives in `server/cloud.js`, and both model paths use the rubric parser in `server/rubric.js`. The app and API bind to localhost by default. Run the Vite dev or preview server to use scoring. Serving the `dist/` files alone provides only the frontend.
