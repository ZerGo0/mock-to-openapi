import YAML from "yaml";
import { toOpenApi } from "./to-open-api.js";

document.addEventListener("DOMContentLoaded", () => {
	const jsonInput = document.getElementById("jsonInput");
	const yamlOutput = document.getElementById("yamlOutput");
	const convertBtn = document.getElementById("convertBtn");
	const copyYamlBtn = document.getElementById("copyYamlBtn");
	const clearJsonBtn = document.getElementById("clearJsonBtn");
	const splitObjectsToggle = document.getElementById("splitObjectsToggle");

	function convertJsonToOpenApi() {
		try {
			const jsonObj = JSON.parse(jsonInput.value);
			const shouldSplitObjects = splitObjectsToggle.checked;
			const collectedSchemas = {};

			const mainSchema = toOpenApi(jsonObj, shouldSplitObjects, "", collectedSchemas);

			const openApiDoc = {
				openapi: "3.0.0",
				info: {
					title: "Generated API",
					version: "1.0.0",
				},
				paths: {},
				components: {
					schemas: {
						RootObject: mainSchema,
						...collectedSchemas,
					},
				},
			};

			yamlOutput.value = YAML.stringify(openApiDoc);
		} catch (error) {
			yamlOutput.value = `Error: ${error.message}`;
		}
	}

	convertJsonToOpenApi();

	convertBtn.addEventListener("click", convertJsonToOpenApi);

	splitObjectsToggle.addEventListener("change", convertJsonToOpenApi);

	copyYamlBtn.addEventListener("click", async () => {
		try {
			await navigator.clipboard.writeText(yamlOutput.value);

			// Visual feedback
			const originalText = copyYamlBtn.textContent;
			copyYamlBtn.textContent = "Copied!";
			copyYamlBtn.classList.add("btn-success");
			copyYamlBtn.classList.remove("btn-secondary");

			setTimeout(() => {
				copyYamlBtn.textContent = originalText;
				copyYamlBtn.classList.remove("btn-success");
				copyYamlBtn.classList.add("btn-secondary");
			}, 1500);
		} catch (err) {
			// Fallback for browsers that don't support clipboard API
			yamlOutput.select();
			document.execCommand("copy");
		}
	});

	clearJsonBtn.addEventListener("click", () => {
		jsonInput.value = "";
		yamlOutput.value = "";
	});
});
