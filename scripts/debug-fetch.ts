import "dotenv/config";

async function main() {
  const url = "https://different-cormorant-663.convex.site/api/submit";
  const tickers = [
    "AAPL","NVDA","MSFT","GOOG","AMZN","META","TSLA","AMD","INTC","CRM",
    "ORCL","AVGO","ADBE","NFLX","PYPL","CSCO","QCOM","TXN","MU","AMAT",
    "LRCX","KLAC","MRVL","SNPS","CDNS","ON","MCHP","FTNT","ZS","PANW",
    "CRWD","DDOG","NET","SNOW","MDB","PLTR","COIN","MARA","RIOT","CLSK",
    "IREN","APLD","WULF","CIFR","HUT","BTDR","BITF","ARBK","SATS","CORZ",
  ];
  const body = {
    team_id: process.env.CALA_TEAM_ID,
    model_agent_name: "debug",
    model_agent_version: "v0",
    transactions: tickers.map(t => ({ nasdaq_code: t, amount: 20_000 })),
  };
  console.log("Sending to", url, "team_id=", body.team_id, "tickers=", tickers.length);
  const t0 = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const elapsed = Date.now() - t0;
    console.log("Status:", res.status, "Time:", elapsed, "ms");
    console.log("Content-Type:", res.headers.get("content-type"));
    const text = await res.text();
    console.log("Body length:", text.length);
    console.log("First 800 chars:", text.slice(0, 800));
    try {
      const json = JSON.parse(text);
      console.log("JSON parsed OK. Keys:", Object.keys(json));
      if (json.success) {
        console.log("total_value:", json.total_value);
        const prices = json.purchase_prices_apr15 ?? {};
        console.log("purchase_prices count:", Object.keys(prices).length);
      }
    } catch (e) {
      console.error("JSON.parse failed:", (e as Error).message);
    }
  } catch (e) {
    console.error("Fetch error:", (e as Error).message);
  } finally {
    clearTimeout(timer);
  }
}

main();
