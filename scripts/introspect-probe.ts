/**
 * Introspect-probe: discover what financial metrics are available per entity.
 * Goal: find price/return metrics so we can identify highest-returning stocks.
 */

import "dotenv/config";
import { getCalaClient } from "../lib/cala";

const cala = getCalaClient();

const TEST_ENTITIES = [
  ["NVDA", "NVIDIA CORP"],
  ["MSTR", "MICROSTRATEGY"],
  ["PLTR", "PALANTIR TECHNOLOGIES"],
  ["SMCI", "SUPER MICRO COMPUTER"],
  ["COIN", "COINBASE GLOBAL"],
];

async function probeEntity(ticker: string, searchName: string) {
  console.log(`\n${"═".repeat(60)}`);
  console.log(`  ${ticker} — ${searchName}`);
  console.log(`${"═".repeat(60)}`);

  // Step 1: Search for entity
  const searchRes = await cala.searchEntities(searchName, { entityTypes: ["Company"], limit: 3 });
  if (!searchRes.entities?.length) {
    console.log("  ❌ No entities found");
    return;
  }

  const entity = searchRes.entities[0];
  console.log(`  Entity: ${entity.name} (${entity.id})`);

  await new Promise(r => setTimeout(r, 500));

  // Step 2: Introspect
  const intro = await cala.introspect(entity.id);
  
  // Dump the full introspection structure
  console.log(`\n  📋 Introspection keys: ${Object.keys(intro).join(", ")}`);

  for (const [key, value] of Object.entries(intro)) {
    if (Array.isArray(value)) {
      console.log(`\n  [${key}] — ${value.length} items:`);
      for (const item of value.slice(0, 15)) {
        if (typeof item === "object" && item !== null) {
          const obj = item as Record<string, unknown>;
          const name = obj.name ?? obj.label ?? obj.id ?? "?";
          const id = obj.id ?? "";
          const unit = obj.unit ?? "";
          const cadence = obj.cadence ?? "";
          const taxonomy = obj.taxonomy ?? "";
          console.log(`    • ${String(name).padEnd(50)} id=${String(id).slice(0,12)}  unit=${unit}  cadence=${cadence}  tax=${taxonomy}`);
        } else {
          console.log(`    • ${JSON.stringify(item).slice(0, 100)}`);
        }
      }
      if (value.length > 15) console.log(`    ... and ${value.length - 15} more`);
    } else if (typeof value === "object" && value !== null) {
      const obj = value as Record<string, unknown>;
      console.log(`\n  [${key}] — object with keys: ${Object.keys(obj).join(", ")}`);
      for (const [subKey, subVal] of Object.entries(obj)) {
        if (Array.isArray(subVal)) {
          console.log(`    ${subKey}: ${subVal.length} items`);
          for (const item of subVal.slice(0, 10)) {
            if (typeof item === "object" && item !== null) {
              const o = item as Record<string, unknown>;
              const name = o.name ?? o.label ?? o.id ?? "?";
              const id = o.id ?? "";
              const unit = o.unit ?? "";
              const cadence = o.cadence ?? "";
              console.log(`      • ${String(name).padEnd(50)} id=${String(id).slice(0,12)}  unit=${unit}  cadence=${cadence}`);
            }
          }
          if (subVal.length > 10) console.log(`      ... and ${subVal.length - 10} more`);
        } else {
          console.log(`    ${subKey}: ${JSON.stringify(subVal).slice(0, 120)}`);
        }
      }
    } else {
      console.log(`\n  [${key}] = ${JSON.stringify(value).slice(0, 200)}`);
    }
  }

  await new Promise(r => setTimeout(r, 500));

  // Step 3: Try to get entity data with the discovered metric IDs
  const allMetricIds: string[] = [];
  for (const [key, value] of Object.entries(intro)) {
    if (key === "FinancialMetric" || key === "numerical_observations") {
      const items = Array.isArray(value) ? value : Object.values(value as Record<string, unknown>).flat();
      for (const item of items) {
        if (typeof item === "object" && item !== null) {
          const obj = item as Record<string, unknown>;
          if (typeof obj.id === "string") allMetricIds.push(obj.id);
        }
      }
    }
  }

  if (allMetricIds.length > 0) {
    console.log(`\n  📊 Fetching entity data for ${allMetricIds.length} metrics...`);
    const projection = {
      numerical_observations: { FinancialMetric: allMetricIds.slice(0, 20) },
    };
    
    try {
      const entityData = await cala.getEntity(entity.id, projection);
      console.log(`\n  Entity data keys: ${Object.keys(entityData).join(", ")}`);
      
      for (const [key, value] of Object.entries(entityData)) {
        if (key === "numerical_observations" || key === "FinancialMetric") {
          const items = Array.isArray(value) ? value : [];
          console.log(`  [${key}]: ${items.length} observations`);
          for (const item of items.slice(0, 5)) {
            console.log(`    ${JSON.stringify(item).slice(0, 200)}`);
          }
        }
      }
    } catch (err) {
      console.log(`  ❌ getEntity failed: ${(err as Error).message}`);
    }
  }
}

async function main() {
  console.log("🔬 Introspection Probe — Discovering available metrics\n");

  for (const [ticker, name] of TEST_ENTITIES) {
    try {
      await probeEntity(ticker, name);
    } catch (err) {
      console.error(`  ❌ ${ticker} failed: ${(err as Error).message}`);
    }
    await new Promise(r => setTimeout(r, 1000));
  }
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
