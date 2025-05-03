import { getFormat } from "./get-format.js";
import { getType } from "./get-type.js";

const REF_PREFIX = "#/components/schemas/";
const ARRAY_ITEM_KEY = "item";
const PATH_SANITIZER_REGEX = /[^a-zA-Z0-9_-]/g;
function sanitizePathComponent(component) {
	return String(component).replace(PATH_SANITIZER_REGEX, "_");
}

function mergeProperties(props1, props2) {
	const merged = { ...props1 };

	for (const key in props2) {
		if (Object.prototype.hasOwnProperty.call(props2, key)) {
			if (!Object.prototype.hasOwnProperty.call(merged, key)) {
				// Property only in props2, add it
				merged[key] = props2[key];
			} else {
				// Property exists in both. Attempt to merge them.
				const val1 = merged[key];
				const val2 = props2[key];

				// Check if both are valid object schemas for merging properties
				if (val1 && typeof val1 === "object" && !Array.isArray(val1) && val1.type === "object" && val1.properties && val2 && typeof val2 === "object" && !Array.isArray(val2) && val2.type === "object" && val2.properties) {
					// Merge required arrays if they exist
					let requiredProps = [];
					if (Array.isArray(val1.required)) {
						requiredProps = [...val1.required];
					}
					if (Array.isArray(val2.required)) {
						// Add unique required properties from val2
						for (const req of val2.required) {
							if (!requiredProps.includes(req)) {
								requiredProps.push(req);
							}
						}
					}

					merged[key] = {
						...val1, // Keep type etc. from val1
						properties: mergeProperties(val1.properties, val2.properties),
						...(requiredProps.length > 0 ? { required: requiredProps } : {}),
					};
				} else if (val1.type !== val2.type) {
					// Handle type conflicts with anyOf
					merged[key] = { anyOf: [val1, val2] };
				}
			}
		}
	}
	return merged;
}

// Helper function to resolve schema references from a schema
function resolveReferences(schema, schemas) {
	if (!schema || typeof schema !== "object") {
		return schema;
	}

	// If this is a reference, resolve it
	if (schema.$ref && typeof schema.$ref === "string") {
		const refPath = schema.$ref.replace(REF_PREFIX, "");
		const referencedSchema = schemas?.[refPath];
		if (referencedSchema) {
			// Return a copy to avoid modifying the original schema
			return { ...referencedSchema };
		}
	}

	return schema;
}

/**
 * Convert item to OpenAPI schema
 * @param item
 * @param {boolean} [splitObjects=false] - Whether to split nested objects into separate schemas.
 * @param {string} [currentPath=''] - The current path within the JSON structure.
 * @param {object} [schemas={}] - An object to collect split schemas.
 * @returns {object} - OpenAPI schema object or a reference.
 */
export function toOpenApi(item, splitObjects = false, currentPath = "", schemas = {}) {
	const type = getType(item);

	if (splitObjects && type === "object" && currentPath) {
		// Generate schema name from path
		const schemaName = currentPath.split(".").map(sanitizePathComponent).join("_");

		// If this schema name is already being processed or is fully defined, return the reference
		if (schemas[schemaName]) {
			return { $ref: `${REF_PREFIX}${schemaName}` };
		}

		// Mark as being processed (placeholder) to prevent infinite loops
		schemas[schemaName] = {};

		// Generate the actual schema definition for this object
		const actualDefinition = { type: "object", properties: {} };
		for (const [key, value] of Object.entries(item)) {
			const nextPath = currentPath ? `${currentPath}.${key}` : key;
			// Continue passing splitObjects=true so children can be split
			actualDefinition.properties[key] = toOpenApi(
				value,
				true, // Keep splitting enabled for children
				nextPath,
				schemas,
			);
		}
		// Store the final definition, replacing the placeholder
		schemas[schemaName] = actualDefinition;

		// Return a reference to the schema
		return { $ref: `${REF_PREFIX}${schemaName}` };
	}

	const oa = {};
	const format = getFormat(item);
	const example = item;

	switch (type) {
		case "object": {
			oa.type = "object";
			oa.properties = {};
			for (const [key, value] of Object.entries(item)) {
				// Generate the path for the child
				const nextPath = currentPath ? `${currentPath}.${key}` : key;
				oa.properties[key] = toOpenApi(value, splitObjects, nextPath, schemas);
			}
			break;
		}

		case "array": {
			if (item.length === 0) {
				// Handle empty array
				return { type: "array", items: {} };
			}

			// Check if we have primitive types or objects
			const firstItemType = getType(item[0]);
			const isPrimitiveArray = ["string", "number", "boolean", "integer"].includes(firstItemType);

			// For primitive types, don't split even if splitting is enabled
			if (isPrimitiveArray) {
				// Check if all items are of the same type
				const allSameType = item.every((elem) => getType(elem) === firstItemType);

				if (allSameType) {
					// Use the first item as example for the array items schema
					return {
						type: "array",
						items: toOpenApi(item[0], false),
					};
				}

				// If mixed primitive types, create a more generic schema
				return {
					type: "array",
					items: {
						anyOf: [...new Set(item.map((elem) => getType(elem)))].map((type) => ({ type })),
					},
				};
			}

			// Generate schemas for all items to find all possible properties
			const path = currentPath ? currentPath : "root";
			const itemSchemas = item.map((element, index) => toOpenApi(element, splitObjects, `${path}.${ARRAY_ITEM_KEY}`, schemas));

			// For arrays of objects, we need to handle both direct object schemas and references
			if (splitObjects) {
				// Create a unique path for this array's item schema
				const arrayItemPath = `${path}.${ARRAY_ITEM_KEY}`;
				const schemaName = arrayItemPath.split(".").map(sanitizePathComponent).join("_");

				// Collect all unique properties from all array items
				const allProperties = {};

				// First, create schemas for all nested objects in all array items
				for (const element of item) {
					if (getType(element) === "object") {
						for (const [key, value] of Object.entries(element)) {
							// For each property in the object
							const propPath = `${arrayItemPath}.${key}`;
							toOpenApi(value, splitObjects, propPath, schemas);
						}
					}
				}

				// Now collect and merge all properties from all array items
				for (const element of item) {
					// Process each array item to collect properties
					if (getType(element) === "object") {
						for (const [key, value] of Object.entries(element)) {
							// For each property in the object
							const propPath = `${arrayItemPath}.${key}`;
							const propSchema = toOpenApi(value, splitObjects, propPath, schemas);

							if (!allProperties[key]) {
								allProperties[key] = propSchema;
							} else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
								// For nested objects, merge any new properties into referenced schemas
								const existingSchema = allProperties[key];
								const newSchema = propSchema;

								// If both are references, resolve them and merge their properties
								if (existingSchema.$ref && newSchema.$ref) {
									const existingRef = existingSchema.$ref.replace(REF_PREFIX, "");
									const newRef = newSchema.$ref.replace(REF_PREFIX, "");

									if (existingRef === newRef) {
										// They reference the same schema, so we need to update that schema
										// with all properties from all instances of this nested object
										const schemaToUpdate = schemas?.[existingRef];
										if (schemaToUpdate?.properties) {
											// Get all properties of the current object value
											const objectProperties = {};
											for (const [nestedKey, nestedValue] of Object.entries(value)) {
												const nestedPath = `${propPath}.${nestedKey}`;
												objectProperties[nestedKey] = toOpenApi(nestedValue, splitObjects, nestedPath, schemas);
											}

											// Merge these properties into the existing schema
											if (Object.keys(objectProperties).length > 0) {
												schemaToUpdate.properties = mergeProperties(schemaToUpdate.properties, objectProperties);
											}
										}
									} else {
										// Different references, use the normal merging logic
										const existingRefSchema = schemas?.[existingRef];
										const newRefSchema = schemas?.[newRef];
										if (existingRefSchema?.properties && newRefSchema?.properties) {
											schemas[existingRef].properties = mergeProperties(existingRefSchema.properties, newRefSchema.properties);
										}
									}
								}
							}
						}
					}
				}

				// Create or update the schema for this array's item type
				if (!schemas[schemaName] || Object.keys(schemas[schemaName]).length === 0) {
					schemas[schemaName] = {
						type: "object",
						properties: allProperties,
					};
				} else {
					// If schema already exists, merge in any new properties
					schemas[schemaName].properties = {
						...schemas[schemaName].properties,
						...allProperties,
					};
				}

				// Return array schema with reference to the item schema
				return {
					type: "array",
					items: { $ref: `${REF_PREFIX}${schemaName}` },
				};
			}

			// If not splitting objects or no object schemas found, fall back to original logic
			const objectSchemas = itemSchemas.filter((s) => s && typeof s === "object" && ((s.type === "object" && s.properties) || s.$ref));

			if (objectSchemas.length === 0) {
				// If no objects found (e.g., array of strings), use the first item's schema
				return { type: "array", items: itemSchemas[0] || {} };
			}

			// Merge properties from all object schemas found in the array
			let finalMergedProperties = {};
			for (const objSchema of objectSchemas) {
				const resolvedSchema = resolveReferences(objSchema, schemas);
				if (resolvedSchema.properties) {
					finalMergedProperties = mergeProperties(finalMergedProperties, resolvedSchema.properties);
				}
			}

			// Return the array schema with merged object properties
			return {
				type: "array",
				items: {
					type: "object",
					properties: finalMergedProperties,
				},
			};
		}

		case "integer": {
			return { type, format, example };
		}

		case "number": {
			return { type, example };
		}

		case "boolean": {
			return { type, example };
		}

		case "string": {
			return format ? { type, format, example } : { type, example };
		}

		default: {
			return { type: "string", format: "nullable" };
		}
	}

	return oa;
}
