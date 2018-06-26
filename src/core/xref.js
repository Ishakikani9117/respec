import { norm } from "core/utils";

export async function main(conf, possibleExternalLinks) {
  conf.xrefs = getRefMap(possibleExternalLinks);
  const query = createXrefQuery(conf.xrefs);
  const results = await fetchXrefs(query);
  addDataCiteToTerms(results, conf);
}

// returns possible external refs as Map(term, [{elem, specs, types}])
function getRefMap(elems) {
  return elems.reduce((xrefs, elem) => {
    let term = "xref" in elem.dataset ? elem.dataset.xref : elem.textContent;
    term = norm(term);
    const datacite = elem.closest("[data-cite]");
    const specs = datacite ? datacite.dataset.cite.split(" ") : [];
    const types = [];
    const xrefsForTerm = xrefs.has(term) ? xrefs.get(term) : [];
    xrefsForTerm.push({ elem, specs, types });
    return xrefs.set(term, xrefsForTerm);
  }, new Map());
}

// creates a body for POST request to API
function createXrefQuery(xrefs) {
  return [...xrefs.entries()].reduce(
    (query, [term, refs]) => {
      refs.reduce((keys, { specs, types }) => {
        keys.push({ term, specs, types });
        return keys;
      }, query.keys);
      return query;
    },
    { keys: [] }
  );
  // todo: return only unique
}

// fetch from network
async function fetchXrefs(query) {
  return await simulateShepherd(query);
}

// disambiguate fetched results based on xref{specs,types} i.e. context
function disambiguate(data, context) {
  if (!data || !data.length) return null;
  const { elem, specs } = context;
  if (data.length === 1) {
    if (specs.length && !specs.includes(data[0].spec)) {
      elem.classList.add("respec-offending-element");
      console.warn(`No data for `, elem);
      return null;
    }
    return data[0]; // unambiguous
  }
  console.warn("Ambiguity in data for", elem); // todo
  elem.classList.add("respec-offending-element");
  return null;
}

// adds data-cite attributes to terms
// on elem from conf.xref[term] for which results are found.
function addDataCiteToTerms(results, conf) {
  for (const term in results) {
    conf.xrefs.get(term).forEach(entry => {
      const { elem } = entry;
      const result = disambiguate(results[term], entry);
      if (!result) {
        return;
      }
      const { uri, spec: cite, normative } = result;
      if (normative == true) {
        conf.normativeReferences.add(cite);
      } else {
        if (elem.closest(".informative")) {
          conf.informativeReferences.add(cite);
        } else {
          const msg = "Adding informative reference to normative section";
          console.warn(msg, entry);
        }
      }
      const path = uri.includes("/") ? uri.split("/", 1)[1] : uri;
      const [citePath, citeFrag] = path.split("#");
      Object.assign(elem.dataset, { cite, citePath, citeFrag });
    });
  }
}

// just a network simulation for prototype ignore.
async function simulateShepherd(query) {
  // live experimental end point:
  // https://wt-466c7865b463a6c4cbb820b42dde9e58-0.sandbox.auth0-extend.com/respec-xref-proto
  const result = {};
  const data = await (await fetch("/tests/data/xref.json")).json();
  for (const key of query.keys) {
    const { term } = key;
    result[term] = result[term] || [];
    if (term in data) {
      for (const item of data[term]) {
        if (
          filterFn(item, key) &&
          !result[term].find(t => t.uri === item.uri)
        ) {
          result[term].push(item);
        }
      }
    }
  }
  return result;

  function filterFn(item, { specs, types }) {
    let valid = true;
    if (Array.isArray(specs) && specs.length) {
      valid = specs.includes(item.spec);
    }
    if (Array.isArray(types) && types.length) {
      valid = valid && types.includes(item.type);
    }
    return valid;
  }
}
