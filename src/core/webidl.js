// Module core/webidl
//  Highlights and links WebIDL marked up inside <pre class="idl">.

// TODO:
//  - It could be useful to report parsed IDL items as events
//  - don't use generated content in the CSS!
import * as webidl2 from "webidl2";
import { flatten, showInlineError, showInlineWarning } from "./utils.js";
import { decorateDfn } from "./dfn-finder.js";
import hyperHTML from "../../js/html-template.js";

export const name = "core/webidl";

async function loadStyle() {
  try {
    return (await import("text!../../assets/webidl.css")).default;
  } catch {
    const loader = await import("./asset-loader.js");
    return loader.loadAssetOnNode("webidl.css");
  }
}

/**
 * Takes the result of WebIDL2.parse(), an array of definitions.
 * @param {import("../respec-document.js").RespecDocument} respecDoc
 */
function makeMarkup(parse, respecDoc) {
  const templates = {
    wrap(items) {
      return items
        .reduce(flatten, [])
        .filter(x => x !== "")
        .map(x =>
          typeof x === "string" ? respecDoc.document.createTextNode(x) : x
        );
    },
    trivia(t) {
      if (!t.trim()) {
        return t;
      }
      return hyperHTML`<span class='idlSectionComment'>${t}</span>`;
    },
    generic(keyword) {
      // Shepherd classifies "interfaces" as starting with capital letters,
      // like Promise, FrozenArray, etc.
      return /^[A-Z]/.test(keyword)
        ? hyperHTML`<a data-xref-type="interface" data-cite="WebIDL">${keyword}</a>`
        : // Other keywords like sequence, maplike, etc...
          hyperHTML`<a data-xref-type="dfn" data-cite="WebIDL">${keyword}</a>`;
    },
    reference(wrapped, unescaped, context) {
      let type = "_IDL_";
      let cite = null;
      let lt;
      switch (unescaped) {
        case "Window":
          type = "interface";
          cite = "HTML";
          break;
        case "object":
          type = "interface";
          cite = "WebIDL";
          break;
        default: {
          const isWorkerType = unescaped.includes("Worker");
          if (
            isWorkerType &&
            context.type === "extended-attribute" &&
            context.name === "Exposed"
          ) {
            lt = `${unescaped}GlobalScope`;
            type = "interface";
            cite = ["Worker", "DedicatedWorker", "SharedWorker"].includes(
              unescaped
            )
              ? "HTML"
              : null;
          }
        }
      }
      return hyperHTML`<a
        data-xref-type="${type}" data-cite="${cite}" data-lt="${lt}">${wrapped}</a>`;
    },
    name(escaped, { data, parent }) {
      if (data.idlType && data.idlType.type === "argument-type") {
        return hyperHTML`<span class="idlParamName">${escaped}</span>`;
      }
      const idlLink = defineIdlName(escaped, data, parent, respecDoc);
      if (data.type !== "enum-value") {
        const className = parent ? "idlName" : "idlID";
        idlLink.classList.add(className);
      }
      return idlLink;
    },
    nameless(escaped, { data, parent }) {
      switch (data.type) {
        case "constructor":
          return defineIdlName(escaped, data, parent, respecDoc);
        default:
          return escaped;
      }
    },
    type(contents) {
      return hyperHTML`<span class="idlType">${contents}</span>`;
    },
    inheritance(contents) {
      return hyperHTML`<span class="idlSuperclass">${contents}</span>`;
    },
    definition(contents, { data, parent }) {
      const className = getIdlDefinitionClassName(data);
      switch (data.type) {
        case "includes":
        case "enum-value":
          return hyperHTML`<span class='${className}'>${contents}</span>`;
      }
      const parentName = parent ? parent.name : "";
      const { name, idlId } = respecDoc.idlNameMap.getNameAndId(
        data,
        parentName
      );
      return hyperHTML`<span class='${className}' id='${idlId}' data-idl data-title='${name}'>${contents}</span>`;
    },
    extendedAttribute(contents) {
      const result = hyperHTML`<span class="extAttr">${contents}</span>`;
      return result;
    },
    extendedAttributeReference(name) {
      return hyperHTML`<a data-xref-type="extended-attribute">${name}</a>`;
    },
  };
  return webidl2.write(parse, { templates });
}

/**
 * Returns a link to existing <dfn> or creates one if doesn’t exists.
 * @param {import("../respec-document.js").RespecDocument} respecDoc
 */
function defineIdlName(escaped, data, parent, respecDoc) {
  const parentName = parent ? parent.name : "";
  const { name } = respecDoc.idlNameMap.getNameAndId(data, parentName);
  const dfn = respecDoc.definitionMap.findDfn(data, name, {
    parent: parentName,
  });
  const linkType = getDfnType(data.type);
  if (dfn) {
    if (!data.partial) {
      dfn.dataset.export = "";
      dfn.dataset.dfnType = linkType;
    }
    decorateDfn(dfn, data, parentName, name);
    respecDoc.definitionMap.addAlternativeNamesByType(
      dfn,
      data.type,
      parentName,
      name
    );
    const href = `#${dfn.id}`;
    return hyperHTML`<a
      data-link-for="${parentName}"
      data-link-type="${linkType}"
      href="${href}"
      class="internalDFN"
      ><code>${escaped}</code></a>`;
  }

  const isDefaultJSON =
    data.type === "operation" &&
    data.name === "toJSON" &&
    data.extAttrs.some(({ name }) => name === "Default");
  if (isDefaultJSON) {
    return hyperHTML`<a
     data-link-type="dfn"
     data-lt="default toJSON operation">${escaped}</a>`;
  }
  if (!data.partial) {
    const dfn = hyperHTML`<dfn data-export data-dfn-type="${linkType}">${escaped}</dfn>`;
    respecDoc.definitionMap.registerDefinition(dfn, [name]);
    decorateDfn(dfn, data, parentName, name);
    respecDoc.definitionMap.addAlternativeNamesByType(
      dfn,
      data.type,
      parentName,
      name
    );
    return dfn;
  }

  const unlinkedAnchor = hyperHTML`<a
    data-idl="${data.partial ? "partial" : null}"
    data-link-type="${linkType}"
    data-title="${data.name}"
    data-xref-type="${linkType}"
    >${escaped}</a>`;

  const showWarnings =
    name && data.type !== "typedef" && !(data.partial && !dfn);
  if (showWarnings) {
    const styledName = data.type === "operation" ? `${name}()` : name;
    const ofParent = parentName ? ` \`${parentName}\`'s` : "";
    const msg = `Missing \`<dfn>\` for${ofParent} \`${styledName}\` ${data.type}. [More info](https://github.com/w3c/respec/wiki/WebIDL-thing-is-not-defined).`;
    showInlineWarning(unlinkedAnchor, msg, "");
  }
  return unlinkedAnchor;
}

/**
 * Map to Shepherd types, for export.
 * @see https://tabatkins.github.io/bikeshed/#dfn-types
 */
function getDfnType(idlType) {
  switch (idlType) {
    case "operation":
      return "method";
    case "field":
      return "dict-member";
    case "callback interface":
    case "interface mixin":
      return "interface";
    default:
      return idlType;
  }
}

function getIdlDefinitionClassName(defn) {
  switch (defn.type) {
    case "callback interface":
      return "idlInterface";
    case "operation":
      return "idlMethod";
    case "field":
      return "idlMember";
    case "enum-value":
      return "idlEnumItem";
    case "callback function":
      return "idlCallback";
  }
  return `idl${defn.type[0].toUpperCase()}${defn.type.slice(1)}`;
}

export class IDLNameMap extends WeakMap {
  constructor() {
    super();
    this.operationNames = {};
    this.idlPartials = {};
  }

  getNameAndId(defn, parent = "") {
    if (this.has(defn)) {
      return this.get(defn);
    }
    const result = this.resolveNameAndId(defn, parent);
    this.set(defn, result);
    return result;
  }

  resolveNameAndId(defn, parent) {
    let name = getDefnName(defn);
    let idlId = getIdlId(name, parent);
    switch (defn.type) {
      // Top-level entities with linkable members.
      case "callback interface":
      case "dictionary":
      case "interface":
      case "interface mixin": {
        idlId += this.resolvePartial(defn);
        break;
      }
      case "constructor":
      case "operation": {
        const overload = this.resolveOverload(name, parent);
        if (overload) {
          name += overload;
          idlId += overload;
        } else if (defn.arguments.length) {
          idlId += defn.arguments
            .map(arg => `-${arg.name.toLowerCase()}`)
            .join("");
        }
        break;
      }
    }
    return { name, idlId };
  }

  resolvePartial(defn) {
    if (!defn.partial) {
      return "";
    }
    if (!this.idlPartials[defn.name]) {
      this.idlPartials[defn.name] = 0;
    }
    this.idlPartials[defn.name] += 1;
    return `-partial-${this.idlPartials[defn.name]}`;
  }

  resolveOverload(name, parentName) {
    const qualifiedName = `${parentName}.${name}`;
    const fullyQualifiedName = `${qualifiedName}()`;
    let overload;
    if (!this.operationNames[fullyQualifiedName]) {
      this.operationNames[fullyQualifiedName] = 0;
    }
    if (!this.operationNames[qualifiedName]) {
      this.operationNames[qualifiedName] = 0;
    } else {
      overload = `!overload-${this.operationNames[qualifiedName]}`;
    }
    this.operationNames[fullyQualifiedName] += 1;
    this.operationNames[qualifiedName] += 1;
    return overload || "";
  }
}

function getIdlId(name, parentName) {
  if (!parentName) {
    return `idl-def-${name.toLowerCase()}`;
  }
  return `idl-def-${parentName.toLowerCase()}-${name.toLowerCase()}`;
}

function getDefnName(defn) {
  switch (defn.type) {
    case "enum-value":
      return defn.value;
    case "operation":
      return defn.name;
    default:
      return defn.name || defn.type;
  }
}

/**
 * @param {Element} idlElement
 * @param {import("../respec-document.js").RespecDocument} respecDoc
 * @param {number} index
 */
function renderWebIDL(idlElement, respecDoc, index) {
  let parse;
  try {
    parse = webidl2.parse(idlElement.textContent, {
      sourceName: String(index),
    });
  } catch (e) {
    showInlineError(
      idlElement,
      `Failed to parse WebIDL: ${e.bareMessage}.`,
      e.bareMessage,
      { details: `<pre>${e.context}</pre>` }
    );
    // Skip this <pre> and move on to the next one.
    return [];
  }
  idlElement.classList.add("def", "idl");
  const html = makeMarkup(parse, respecDoc);
  idlElement.textContent = "";
  idlElement.append(...html);
  idlElement.querySelectorAll("[data-idl]").forEach(elem => {
    if (elem.dataset.dfnFor) {
      return;
    }
    const title = elem.dataset.title;
    // Select the nearest ancestor element that can contain members.
    const parent = elem.parentElement.closest("[data-idl][data-title]");
    if (parent) {
      elem.dataset.dfnFor = parent.dataset.title;
    }
    respecDoc.definitionMap.registerDefinition(elem, [title]);
  });
  // cross reference
  const closestCite = idlElement.closest("[data-cite], body");
  const { dataset } = closestCite;
  if (!dataset.cite) dataset.cite = "WebIDL";
  // includes webidl in some form
  if (!/\bwebidl\b/i.test(dataset.cite)) {
    const cites = dataset.cite.trim().split(/\s+/);
    dataset.cite = ["WebIDL", ...cites].join(" ");
  }
  return parse;
}

/**
 * @param {import("../respec-document").RespecDocument} respecDoc
 */
export default async function(respecDoc) {
  const { document } = respecDoc;
  const idls = document.querySelectorAll("pre.idl");
  if (!idls.length) {
    return;
  }
  if (!document.querySelector(".idl:not(pre)")) {
    const link = document.querySelector("head link");
    if (link) {
      const style = document.createElement("style");
      style.textContent = await loadStyle();
      link.before(style);
    }
  }
  const astArray = [...idls].map((idl, i) => renderWebIDL(idl, respecDoc, i));

  const validations = webidl2.validate(astArray);
  for (const validation of validations) {
    let details = `<pre>${validation.context}</pre>`;
    if (validation.autofix) {
      validation.autofix();
      details += `Try fixing as:
      <pre>${webidl2.write(astArray[validation.sourceName])}</pre>`;
    }
    showInlineError(
      idls[validation.sourceName],
      `WebIDL validation error: ${validation.bareMessage}`,
      validation.bareMessage,
      { details }
    );
  }
  document.normalize();
}
