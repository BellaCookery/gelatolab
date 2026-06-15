import React, { useState, useMemo, useEffect } from "react";
import { supabase, listarReceitas, salvarReceita, apagarReceita, linhaParaApp } from "./supabase";

// ============================================================================
// MOTOR — formato Corvitto (pontos ABSOLUTOS por receita, como no livro)
// dolcezza = Σ g·POD/100 · PAC = Σ g·PAC/100 · temp sai do PAC normalizado p/ 1kg
// ============================================================================
const SUGAR_COEF = {
  sucrose: { pod: 100, pac: 100 }, dextrose: { pod: 70, pac: 190 },
  invertedSugar: { pod: 130, pac: 190 }, fructose: { pod: 170, pac: 190 },
  glucose62DE: { pod: 64, pac: 120 }, glucose38DE: { pod: 24, pac: 45 },
  lactose: { pod: 16, pac: 100 },
};
// Tabela OFICIAL do Corvitto (livro, pág. 78): faixa de PAC por temperatura de serviço.
// Cada °C corresponde a uma banda de 20 pontos; regra empírica do livro: 20 pts de PAC = 1°C.
const CORVITTO_PAC_TABLE = {
  "-8": [201, 220], "-9": [221, 240], "-10": [241, 260], "-11": [261, 280], "-12": [281, 300],
  "-13": [301, 320], "-14": [321, 340], "-15": [341, 360], "-16": [361, 380], "-17": [381, 400], "-18": [401, 420],
};
const PAC_ANCHOR = { temp: -11, pac: 270 }; // centro da faixa -11°C do livro (261-280)
const ANCHOR_SLOPE = 20; // exatamente a regra do Corvitto: 20 pontos por °C
const bandFor = (t) => CORVITTO_PAC_TABLE[String(t)] || [Math.round(270 + (-11 - t) * 20 - 10), Math.round(270 + (-11 - t) * 20 + 10)];
const basePacForTemp = (t) => { const b = bandFor(t); return Math.round((b[0] + b[1]) / 2); };
const tempForPac = (pac) => PAC_ANCHOR.temp - (pac - PAC_ANCHOR.pac) / ANCHOR_SLOPE;
const FAMILY_PAC_OFFSET = { cream: 0, yogurt: 8, yolk: 0, sorbetFruit: 18, fruitCream: 10, chocolate: 20, nuts: -8, teaSpiceCream: 0, teaSpiceSorbet: 18, savory: 0, savorySorbet: 14, liquorCream: -10, sorbetAlcohol: 30, sorbetCitrus: 24 };
const PAC_TOLERANCE = 10;
const pacTargetFor = (t, f) => basePacForTemp(t) + (FAMILY_PAC_OFFSET[f] ?? 0);
// faixas em % (gordura, sólidos, açúcares) e em PONTOS absolutos /1kg (pod)
const FAMILY_RANGES = {
  cream: { fat: { min: 6, max: 12 }, solids: { min: 34, max: 42 }, sugars: { min: 16, max: 22 }, pod: { min: 140, max: 220 } },
  yolk: { fat: { min: 8, max: 14 }, solids: { min: 36, max: 44 }, sugars: { min: 16, max: 22 }, pod: { min: 140, max: 210 } },
  nuts: { fat: { min: 8, max: 16 }, solids: { min: 38, max: 46 }, sugars: { min: 15, max: 21 }, pod: { min: 130, max: 200 } },
  chocolate: { fat: { min: 8, max: 14 }, solids: { min: 38, max: 46 }, sugars: { min: 16, max: 22 }, pod: { min: 140, max: 200 } },
  yogurt: { fat: { min: 4, max: 6 }, solids: { min: 30, max: 38 }, sugars: { min: 18, max: 24 }, pod: { min: 150, max: 220 } },
  sorbetFruit: { fat: { min: 0, max: 2 }, solids: { min: 26, max: 34 }, sugars: { min: 22, max: 30 }, pod: { min: 180, max: 260 } },
  sorbetCitrus: { fat: { min: 0, max: 1 }, solids: { min: 26, max: 32 }, sugars: { min: 20, max: 26 }, pod: { min: 180, max: 240 } },
  sorbetAlcohol: { fat: { min: 0, max: 2 }, solids: { min: 20, max: 32 }, sugars: { min: 18, max: 28 }, pod: { min: 140, max: 220 } },
  savory: { fat: { min: 6, max: 12 }, solids: { min: 34, max: 44 }, sugars: { min: 8, max: 14 }, pod: { min: 60, max: 110 } },
  fruitCream: { fat: { min: 4, max: 9 }, solids: { min: 32, max: 40 }, sugars: { min: 18, max: 24 }, pod: { min: 150, max: 230 } },
  teaSpiceCream: { fat: { min: 6, max: 12 }, solids: { min: 34, max: 42 }, sugars: { min: 16, max: 22 }, pod: { min: 140, max: 220 } },
  teaSpiceSorbet: { fat: { min: 0, max: 2 }, solids: { min: 26, max: 34 }, sugars: { min: 22, max: 30 }, pod: { min: 180, max: 260 } },
  savorySorbet: { fat: { min: 0, max: 3 }, solids: { min: 24, max: 34 }, sugars: { min: 6, max: 12 }, pod: { min: 50, max: 100 } },
  liquorCream: { fat: { min: 6, max: 12 }, solids: { min: 34, max: 42 }, sugars: { min: 14, max: 20 }, pod: { min: 130, max: 200 } },
};
// Parâmetros de controle por família. null = não se aplica (mostra esmaecido).
// Cada parâmetro: [min, max] ou null. PAC é tratado à parte (vem da temperatura).
const FAMILY_PARAMS = {
  cream:        { sugars:[16,22], fat:[6,12],  msnf:[7,11],  other:[0,8],  neutro:[0,0.5], solids:[34,42], pod:[140,220], fruit:null,    alcohol:null,  chopped:[0,12] },
  yolk:         { sugars:[16,22], fat:[8,14],  msnf:[7,11],  other:[0,8],  neutro:[0,0.5], solids:[36,44], pod:[140,210], fruit:null,    alcohol:null,  chopped:[0,12] },
  nuts:         { sugars:[15,21], fat:[8,16],  msnf:[7,11],  other:[5,15], neutro:[0,0.5], solids:[38,46], pod:[130,200], fruit:null,    alcohol:null,  chopped:[5,15] },
  chocolate:    { sugars:[16,22], fat:[8,14],  msnf:[7,11],  other:[8,16], neutro:[0,0.5], solids:[38,46], pod:[140,200], fruit:null,    alcohol:null,  chopped:[0,12] },
  yogurt:       { sugars:[18,24], fat:[4,6],   msnf:[8,12],  other:[0,6],  neutro:[0,0.5], solids:[30,38], pod:[150,220], fruit:null,    alcohol:null,  chopped:[0,12] },
  sorbetFruit:  { sugars:[22,30], fat:null,    msnf:null,    other:[2,10], neutro:[0.2,0.6], solids:[26,34], pod:[180,260], fruit:[25,50], alcohol:null,  chopped:null },
  sorbetCitrus: { sugars:[20,26], fat:null,    msnf:null,    other:[0,5],  neutro:[0.2,0.6], solids:[26,32], pod:[180,240], fruit:[45,65], alcohol:null,  chopped:null },
  sorbetAlcohol:{ sugars:[18,28], fat:null,    msnf:null,    other:[0,6],  neutro:[0.2,0.6], solids:[20,32], pod:[140,220], fruit:null,    alcohol:[1,10], chopped:null },
  savory:       { sugars:[8,14],  fat:[6,12],  msnf:[7,11],  other:[2,12], neutro:[0,0.5], solids:[34,44], pod:[60,110],  fruit:null,    alcohol:null,  chopped:[0,12] },
  fruitCream:   { sugars:[18,24], fat:[4,9],   msnf:[6,10],  other:[2,12], neutro:[0,0.5], solids:[32,40], pod:[150,230], fruit:[20,40], alcohol:null,  chopped:[0,12] },
  teaSpiceCream:{ sugars:[16,22], fat:[6,12],  msnf:[7,11],  other:[0,8],  neutro:[0,0.5], solids:[34,42], pod:[140,220], fruit:null,    alcohol:null,  chopped:[0,12] },
  teaSpiceSorbet:{ sugars:[22,30], fat:null,   msnf:null,    other:[0,8],  neutro:[0.2,0.6], solids:[26,34], pod:[180,260], fruit:null,    alcohol:null,  chopped:null },
  savorySorbet: { sugars:[6,12],  fat:null,    msnf:null,    other:[2,12], neutro:[0.2,0.6], solids:[24,34], pod:[50,100],  fruit:null,    alcohol:null,  chopped:null },
  liquorCream:  { sugars:[14,20], fat:[6,12],  msnf:[7,11],  other:[0,8],  neutro:[0,0.5], solids:[34,42], pod:[130,200], fruit:null,    alcohol:[1,10], chopped:[0,12] },
};
const SUGAR_KINDS = ["sucrose", "dextrose", "invertedSugar", "fructose", "glucose62DE", "glucose38DE", "lactose"];
const ALCOHOL_PAC_COEF = 3.7;
const round = (n, d = 0) => { const f = 10 ** d; return Math.round(n * f) / f; };
// Rótulos em português para os ingredientes citados nas recomendações de ajuste.
const SWAP_LABEL = { inverted: "invertido", dextrose: "dextrose", sacarose: "sacarose", sucrose: "sacarose", erythritol: "eritritol", stevia: "stevia", monkfruit: "monk fruit" };
const swapLabel = (s) => SWAP_LABEL[s] || s;
// Deriva tags de perfil nutricional a partir dos ingredientes reais da receita.
// items: [{ingredient, grams}]. Regras simples e honestas, baseadas no que está na fórmula.
function nutriTags(items, INGS) {
  const get = (id) => (typeof items[0]?.ingredient === "object" ? items.map((it) => it.ingredient) : items.map((x) => INGS.find((i) => i.id === x.id))).filter(Boolean);
  const ings = items.map((it) => it.ingredient || INGS.find((i) => i.id === it.id)).filter(Boolean);
  const total = items.reduce((a, it) => a + (Number(it.grams) || 0), 0) || 1;
  const has = (id) => items.some((it) => (it.ingredient?.id || it.id) === id && (Number(it.grams) || 0) > 0);
  const gramsOf = (pred) => items.reduce((a, it) => { const ing = it.ingredient || INGS.find((i) => i.id === it.id); return a + (ing && pred(ing) ? (Number(it.grams) || 0) : 0); }, 0);
  const tags = [];
  // açúcar refinado (sacarose) em % da receita
  const sucroseG = gramsOf((i) => i.id === "sucrose");
  const sugarG = gramsOf((i) => i.cat === "sugar" && !i.clean);
  const hasIntense = ings.some((i) => i.intense);
  const hasPolyol = ings.some((i) => i.clean && i.cat === "sweet-other");
  if (sucroseG === 0 && (hasIntense || hasPolyol)) tags.push("Sem açúcar adicionado");
  else if (sugarG / total < 0.12 && (hasIntense || hasPolyol)) tags.push("Low sugar");
  // vegano: sem laticínios, gema, mel, queijos (cat dairy ou ids específicos)
  const animal = ings.some((i) => i.cat === "dairy" || ["yolk", "honey", "burrata", "ricotta", "mascarpone", "gorgonzola", "parmesan", "foie-gras", "caviar"].includes(i.id) || i.msnf > 0 && i.cat === "dairy");
  const anyDairy = gramsOf((i) => i.cat === "dairy" || i.id === "yolk" || i.id === "honey") > 0;
  if (!anyDairy) tags.push("Vegano");
  // rico em fibras: inulina presente
  if (has("inulin")) tags.push("Rico em fibras");
  // proteico: leite em pó / proteínas em proporção relevante, ou queijos
  const proteinG = gramsOf((i) => ["smp", "milk-powder", "whey", "caseinate"].includes(i.id) || ["burrata", "ricotta", "mascarpone"].includes(i.id));
  if (proteinG / total > 0.05) tags.push("Proteico");
  // keto: sem açúcar refinado e baixa fração de açúcares totais
  if (sucroseG === 0 && sugarG / total < 0.06 && (hasIntense || hasPolyol)) tags.push("Keto");
  // tradicional: usa açúcar de verdade e nenhum adoçante clean
  if (sucroseG / total >= 0.08 && !hasIntense && !hasPolyol) tags.push("Tradicional");
  return tags;
}
function evalMetric(value, range, ackBelow = false) {
  let status = "in";
  if (value < range.min) status = ackBelow ? "above" : "below";
  else if (value > range.max) status = "above";
  return { value, range, status };
}
// custo REAL por kg de um ingrediente, considerando perdas sequenciais
// perdas em % (limpeza, cocção, descarte) multiplicam o rendimento útil
function realCostPerKg(ing) {
  const yield_ = (1 - (ing.lossClean ?? 0) / 100) * (1 - (ing.lossCook ?? 0) / 100) * (1 - (ing.lossWaste ?? 0) / 100);
  return yield_ > 0 ? ing.costPerKg / yield_ : ing.costPerKg;
}
// calcula uma linha (por ingrediente) no formato do livro
function rowData(it) {
  const g = Number(it.grams) || 0; const ing = it.ingredient;
  let pod = 0, pac = 0, sugarG = 0;
  // somar açúcares discriminados (para o total de açúcar e como fallback)
  for (const k of SUGAR_KINDS) {
    const pct = ing.sugars[k] ?? 0; if (!pct) continue;
    const sg = (g * pct) / 100; sugarG += sg;
    pod += (sg * SUGAR_COEF[k].pod) / 100; pac += (sg * SUGAR_COEF[k].pac) / 100;
  }
  // FIDELIDADE AO LIVRO: se o ingrediente tem POD/PAC direto da tabela do Corvitto,
  // usar esses valores (por 100g) em vez dos derivados. Inclui PAC negativo (gorduras).
  if (ing.podDirect != null && ing.podDirect !== 0 && sugarG === 0) pod = (g * ing.podDirect) / 100;
  if (ing.pacDirect != null && ing.pacDirect !== 0 && sugarG === 0) pac = (g * ing.pacDirect) / 100;
  pac += ((g * ing.alcohol) / 100) * ALCOHOL_PAC_COEF;
  const fat = (g * ing.fat) / 100;
  const msnf = (g * ing.msnf) / 100;
  const water = (g * ing.water) / 100;
  const st = g - water; // sólidos totais do ingrediente
  const alcoholG = (g * ing.alcohol) / 100;
  const otherSol = (g * (ing.otherSolids || 0)) / 100;
  const isNeutro = ing.cat === "neutral";
  const isFruit = ing.cat === "fruit";
  const isChopped = ing.cat === "nuts";
  const neutroG = isNeutro ? g : 0;
  const fruitG = isFruit ? g : 0;
  const choppedG = isChopped ? g : 0;
  return { g, fat, msnf, st, pod, pac, sugarG, alcoholG, otherSol, neutroG, fruitG, choppedG, cost: (g / 1000) * realCostPerKg(ing) };
}
// curva de congelamento: fração de água congelada por temperatura
function freezingCurve(pacPerKg) {
  const Ti = -2.2 - ((pacPerKg - 266) / 266) * 1.5; // ponto inicial de congelamento
  const Teu = -40;
  const f = (T) => { if (T >= Ti) return 0; return Math.min(1, Math.sqrt((Ti - T) / (Ti - Teu))); };
  return { Ti, f };
}
function compute(items, target, opts = {}) {
  const rows = items.map((it) => ({ it, d: rowData(it) }));
  const M = rows.reduce((a, r) => a + r.d.g, 0);
  const safeM = M > 0 ? M : 1;
  const sum = (k) => rows.reduce((a, r) => a + r.d[k], 0);
  const totFat = sum("fat"), totMsnf = sum("msnf"), totSt = sum("st");
  const totPod = sum("pod"), totPac = sum("pac"), totSugar = sum("sugarG"), totCost = sum("cost");
  // normaliza PAC e POD para 1000g (o livro trabalha receita de 1kg)
  const pacPerKg = (totPac / safeM) * 1000;
  const podPerKg = (totPod / safeM) * 1000;
  const fatPct = (totFat / safeM) * 100, stPct = (totSt / safeM) * 100, sugarPct = (totSugar / safeM) * 100;
  // alvos dependentes da temperatura + família (precisam vir ANTES do painel)
  const pacTarget = target.pacOverride ?? pacTargetFor(target.servingTemp, target.family);
  const pacRange = { min: pacTarget - PAC_TOLERANCE, max: pacTarget + PAC_TOLERANCE };
  const ranges = FAMILY_RANGES[target.family];
  const P = FAMILY_PARAMS[target.family] || FAMILY_PARAMS.cream;
  // === PAINEL DE MONITORAMENTO (parâmetros por família) ===
  const pct = (k) => (sum(k) / safeM) * 100;
  // helper: cria uma linha; se a faixa for null, marca como "não se aplica"
  const row = (key, label, range, val, unit, note, refOverride) => {
    if (range == null) return { key, label, na: true, val, unit, note };
    const [min, max] = range;
    return { key, label, min, max, ref: refOverride != null ? refOverride : round((min + max) / 2, unit === "" ? 0 : 1), val, unit, note };
  };
  const MON = [
    row("sugars", "Açúcares", P.sugars, round(sugarPct, 1), "%", "sacarose, dextrose…"),
    row("fat", "Gorduras", P.fat, round(fatPct, 1), "%", "creme, gema…"),
    row("msnf", "Sólidos Lácteos Não Gordurosos (SLNG)", P.msnf, round((totMsnf / safeM) * 100, 1), "%", "leite, leite em pó…"),
    row("other", "Outros Sólidos", P.other, round(pct("otherSol"), 1), "%", "exceto leite em pó"),
    row("neutro", "Neutros e Bases", P.neutro, round(pct("neutroG"), 2), "%", "emulsificantes, estabilizantes"),
    row("solids", "Sólidos Totais", P.solids, round(stPct, 1), "%", "gorduras + açúcares + SLNG + outros"),
    row("pod", "POD", P.pod, round(podPerKg), "", "doçura (pontos/kg)"),
    row("pac", "PAC", [pacRange.min, pacRange.max], round(pacPerKg), "", `anticongelante · alvo p/ ${target.servingTemp}°C`, pacTarget),
    row("fruit", "Frutas", P.fruit, round(pct("fruitG"), 1), "%", "fruta, sucos"),
    row("alcohol", "Álcool", P.alcohol, round(pct("alcoholG"), 1), "%", "vinhos, licores…"),
    row("chopped", "Ingredientes Picados", P.chopped, round(pct("choppedG"), 1), "%", "ingredientes picados"),
  ];
  const ack = opts.acknowledgedBelow ?? {};
  const metrics = {
    pac: evalMetric(round(pacPerKg), pacRange, ack.pac),
    pod: evalMetric(round(podPerKg), ranges.pod, ack.pod),
    fat: evalMetric(round(fatPct, 1), ranges.fat, ack.fat),
    solids: evalMetric(round(stPct, 1), ranges.solids, ack.solids),
    sugars: evalMetric(round(sugarPct, 1), ranges.sugars, ack.sugars),
  };
  const monitor = MON.map((m) => {
    if (m.na) return { ...m, status: "na" };
    let status = "in";
    if (m.val < m.min) status = "below";
    else if (m.val > m.max) status = "above";
    return { ...m, status };
  });
  return {
    rows: rows.map((r) => ({ name: r.it.ingredient.name, cat: r.it.ingredient.cat, ...r.d })),
    totalGrams: M, totFat, totMsnf, totSt, totPod, totPac,
    pacPerKg: round(pacPerKg), podPerKg: round(podPerKg),
    fatPct: round(fatPct, 1), stPct: round(stPct, 1), sugarPct: round(sugarPct, 1),
    msnfPct: round((totMsnf / safeM) * 100, 1),
    pacTarget: round(pacTarget), impliedServingTemp: round(tempForPac(pacPerKg), 1),
    costPerKg: round(totCost / (safeM / 1000), 2), costTotal: round(totCost, 2),
    monitor, metrics, suggestions: buildSuggestions(rows, metrics, safeM, opts),
  };
}
function buildSuggestions(rows, metrics, M, opts = {}) {
  const out = [];
  const method = opts.method || "classic";
  const sg = (id) => rows.filter((r) => r.it.ingredient.id === id).reduce((a, r) => a + r.d.g, 0);
  const pac = metrics.pac;
  if (pac.status !== "in") {
    const center = (pac.range.min + pac.range.max) / 2, delta = center - pac.value;
    const haveSucrose = sg("sucrose");
    if (pac.status === "below") {
      let swap = null;
      const gainPerSucroseG = 900 / M;
      if (method === "clean") {
        // AUTORAL: subir PAC com eritritol (PAC 280). A doçura você repõe adicionando
        // um adoçante intenso (stevia/monk fruit) como ingrediente, pela ficha técnica.
        if (haveSucrose > 0) {
          const X = Math.min(haveSucrose, delta / (1800 / M)); // eritritol sobe mais PAC/g
          if (X >= 1) swap = { blend: true, grams: round(X), remove: "sacarose",
            parts: [{ add: "erythritol", grams: round(X) }] };
        }
        out.push({ message: `PAC ${pac.value} abaixo do alvo (${Math.round(center)}). Autoral: trocar sacarose por eritritol (PAC alto) para subir o anticongelante. Reponha a doçura adicionando stevia ou monk fruit como ingrediente — adaptação moderna, não é Corvitto clássico.`, swap });
      } else {
        // CLÁSSICO Corvitto: blend dextrose + invertido
        if (gainPerSucroseG > 0 && haveSucrose > 0) {
          const X = Math.min(haveSucrose, delta / gainPerSucroseG);
          if (X >= 1) swap = { blend: true, grams: round(X), remove: "sacarose",
            parts: [{ add: "dextrose", grams: round(0.5 * X) }, { add: "inverted", grams: round(0.667 * X) }] };
        }
        out.push({ message: `PAC ${pac.value} abaixo do alvo (${Math.round(center)}) — vai endurecer a essa temperatura. Suba o PAC sem mexer na doçura com o blend dextrose + açúcar invertido.`, swap });
      }
    } else if (pac.status === "above") {
      const haveDextrose = sg("dextrose"), haveInv = sg("inverted");
      const lossPerG = 900 / M;
      let swap = null;
      if ((haveDextrose + haveInv) > 0) {
        const Xmax = Math.min(haveDextrose / 0.5, haveInv / 0.667);
        const X = Math.min(Xmax, Math.abs(delta) / lossPerG);
        if (X >= 1) swap = { blend: true, removeBlend: true, dexCut: round(0.5 * X), invCut: round(0.667 * X),
          parts: [{ add: "sacarose", grams: round(X) }] };
      }
      if (!swap) {
        const perAdd = SUGAR_COEF.sucrose.pac / 100 / M * 1000;
        const g = perAdd > 0 ? Math.abs(delta) / perAdd : 0;
        if (g >= 1) swap = { add: "sacarose", addOnly: true, grams: round(g) };
      }
      out.push({ message: `PAC ${pac.value} acima do alvo (${Math.round(center)}) — vai ficar mole demais. Reduza o anticongelamento trocando dextrose/invertido por sacarose.`, swap });
    }
  }
  const L = { fat: "Gordura", solids: "Sólidos totais", sugars: "Açúcares", pod: "POD (doçura)" };
  const H = {
    fat: { below: "aumente creme ou gema.", above: "troque creme por leite." },
    solids: { below: "aumente leite em pó magro.", above: "reduza sólidos — risco de arenoso." },
    sugars: { below: "aumente os açúcares.", above: "reduza os açúcares." },
    pod: { below: "pouco doce — aumente sacarose/invertido.", above: "doce demais — troque invertido/frutose por dextrose." },
  };
  for (const key of ["fat", "solids", "sugars", "pod"]) {
    const m = metrics[key]; if (m.status === "in") continue;
    const dir = m.value < m.range.min ? "below" : "above";
    out.push({ message: `${L[key]} ${m.value}${key === "pod" ? "" : "%"} fora (${m.range.min}–${m.range.max}): ${H[key][dir]}` });
  }
  return out;
}

// ============================================================================
// BASE DE INGREDIENTES
// ============================================================================
const CATEGORIES = [
  { id: "dairy", label: "Laticínios e ovos" },
  { id: "sugar", label: "Açúcares" },
  { id: "sweet-natural", label: "Adoçantes naturais" },
  { id: "sweet-other", label: "Outros adoçantes / polióis" },
  { id: "neutral", label: "Neutros e bases" }, { id: "fruit", label: "Frutas e vegetais" },
  { id: "main", label: "Ingredientes principais" }, { id: "semi", label: "Semielaborados" },
  { id: "nuts", label: "Frutos secos / picados" }, { id: "alcohol", label: "Álcool" },
  { id: "other", label: "Água e outros" },
];
const INGREDIENTS = [
  { id: "water", cat: "other", name: "Água", water: 100, fat: 0, msnf: 0, otherSolids: 0, sugars: {}, podDirect: 0, pacDirect: 0, alcohol: 0, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 0 },
  { id: "milk-whole", cat: "dairy", name: "Leite integral", water: 88, fat: 3.6, msnf: 8.4, otherSolids: 0, sugars: {}, podDirect: 0, pacDirect: 4, alcohol: 0, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 4.5 },
  { id: "milk-semi", cat: "dairy", name: "Leite parcialmente desnatado", water: 89.2, fat: 1.8, msnf: 8.4, otherSolids: 0, sugars: {}, podDirect: 0, pacDirect: 4, alcohol: 0, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 15 },
  { id: "milk-skim", cat: "dairy", name: "Leite desnatado", water: 91.6, fat: 0, msnf: 8.4, otherSolids: 0, sugars: {}, podDirect: 0, pacDirect: 4, alcohol: 0, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 15 },
  { id: "cream-35", cat: "dairy", name: "Creme 35%", water: 59, fat: 35, msnf: 6, otherSolids: 0, sugars: {}, podDirect: 0, pacDirect: 3, alcohol: 0, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 22 },
  { id: "cream-36", cat: "dairy", name: "Creme 36%", water: 58, fat: 36, msnf: 6, otherSolids: 0, sugars: {}, podDirect: 0, pacDirect: 3, alcohol: 0, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 15 },
  { id: "cream-38", cat: "dairy", name: "Creme 38%", water: 56, fat: 38, msnf: 6, otherSolids: 0, sugars: {}, podDirect: 0, pacDirect: 3, alcohol: 0, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 15 },
  { id: "cream-18", cat: "dairy", name: "Creme de leite 18%", water: 76, fat: 18, msnf: 6, otherSolids: 0, sugars: {}, podDirect: 0, pacDirect: 3, alcohol: 0, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 15 },
  { id: "smp", cat: "dairy", name: "Leite em pó desnatado (LMP)", water: 0, fat: 0, msnf: 100, otherSolids: 0, sugars: {}, podDirect: 0, pacDirect: 50, alcohol: 0, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 28 },
  { id: "wmp", cat: "dairy", name: "Leite em pó 22% gordura", water: 0, fat: 22, msnf: 78, otherSolids: 0, sugars: {}, podDirect: 0, pacDirect: 39, alcohol: 0, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 15 },
  { id: "smp-semi", cat: "dairy", name: "Leite em pó parc. desnatado", water: 0, fat: 11, msnf: 89, otherSolids: 0, sugars: {}, podDirect: 0, pacDirect: 45, alcohol: 0, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 15 },
  { id: "dextrose", cat: "sugar", name: "Dextrose", water: 0, fat: 0, msnf: 0, otherSolids: 0, sugars: { dextrose: 100 }, podDirect: null, pacDirect: null, alcohol: 0, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 9 },
  { id: "inverted", cat: "sugar", name: "Açúcar invertido", water: 25, fat: 0, msnf: 0, otherSolids: 0, sugars: { invertedSugar: 75 }, podDirect: null, pacDirect: null, alcohol: 0, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 10 },
  { id: "honey", cat: "sweet-natural", name: "Mel", water: 20, fat: 0, msnf: 0, otherSolids: 80, sugars: {}, podDirect: 130, pacDirect: 190, alcohol: 0, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 28 },
  { id: "sucrose", cat: "sugar", name: "Sacarose", water: 0, fat: 0, msnf: 0, otherSolids: 0, sugars: { sucrose: 100 }, podDirect: null, pacDirect: null, alcohol: 0, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 6 },
  { id: "glucose-atom-21", cat: "sugar", name: "Glucose atomizada 21 DE", water: 0, fat: 0, msnf: 0, otherSolids: 0, sugars: { glucose38DE: 100 }, podDirect: null, pacDirect: null, alcohol: 0, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 15 },
  { id: "stabilizer", cat: "neutral", name: "Neutro (estabilizante)", water: 0, fat: 0, msnf: 0, otherSolids: 100, sugars: {}, podDirect: 0, pacDirect: 0, alcohol: 0, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 15 },
  { id: "coffee", cat: "main", name: "Café liofilizado", water: 0, fat: 0, msnf: 0, otherSolids: 100, sugars: {}, podDirect: 0, pacDirect: 0, alcohol: 0, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 15 },
  { id: "coffee-espresso", cat: "main", name: "Café espresso", water: 100, fat: 0, msnf: 0, otherSolids: 0, sugars: {}, podDirect: 0, pacDirect: 0, alcohol: 0, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 15 },
  { id: "cinnamon", cat: "main", name: "Infusão de canela", water: 100, fat: 0, msnf: 0, otherSolids: 0, sugars: {}, podDirect: 0, pacDirect: 0, alcohol: 0, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 15 },
  { id: "herbs-infusion", cat: "main", name: "Infusão de ervas aromáticas", water: 100, fat: 0, msnf: 0, otherSolids: 0, sugars: {}, podDirect: 0, pacDirect: 0, alcohol: 0, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 15 },
  { id: "yolk", cat: "dairy", name: "Gema de ovo", water: 44, fat: 30, msnf: 0, otherSolids: 26, sugars: {}, podDirect: 0, pacDirect: 0, alcohol: 0, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 18 },
  { id: "caramel", cat: "semi", name: "Caramelo", water: 0, fat: 0, msnf: 0, otherSolids: 100, sugars: {}, podDirect: 100, pacDirect: 100, alcohol: 0, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 15 },
  { id: "lactose", cat: "sugar", name: "Lactose", water: 0, fat: 0, msnf: 0, otherSolids: 0, sugars: { lactose: 100 }, podDirect: null, pacDirect: null, alcohol: 0, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 15 },
  { id: "yogurt", cat: "dairy", name: "Iogurte integral natural", water: 85, fat: 3.6, msnf: 9.6, otherSolids: 1.8, sugars: {}, podDirect: 0, pacDirect: 5, alcohol: 0, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 15 },
  { id: "yogurt-semi", cat: "dairy", name: "Iogurte parc. desnatado", water: 86.8, fat: 1.8, msnf: 9.6, otherSolids: 1.8, sugars: {}, podDirect: 0, pacDirect: 5, alcohol: 0, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 15 },
  { id: "yogurt-skim", cat: "dairy", name: "Iogurte desnatado", water: 87.6, fat: 0, msnf: 9.6, otherSolids: 2.8, sugars: {}, podDirect: 0, pacDirect: 5, alcohol: 0, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 15 },
  { id: "fruit-lemon", cat: "fruit", name: "Suco de limão", water: 95, fat: 0, msnf: 5, otherSolids: 0, sugars: {}, podDirect: 0, pacDirect: 5, alcohol: 0, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 15 },
  { id: "fruit-lime", cat: "fruit", name: "Suco de lima", water: 95, fat: 0, msnf: 5, otherSolids: 0, sugars: {}, podDirect: 0, pacDirect: 5, alcohol: 0, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 15 },
  { id: "fruit-grapefruit", cat: "fruit", name: "Suco de toranja", water: 89, fat: 0, msnf: 11, otherSolids: 0, sugars: {}, podDirect: 0, pacDirect: 11, alcohol: 0, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 15 },
  { id: "fruit-orange-juice", cat: "fruit", name: "Suco de laranja", water: 86, fat: 0, msnf: 14, otherSolids: 0, sugars: {}, podDirect: 0, pacDirect: 14, alcohol: 0, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 15 },
  { id: "fruit-mandarin", cat: "fruit", name: "Suco de tangerina", water: 91, fat: 0, msnf: 9, otherSolids: 0, sugars: {}, podDirect: 0, pacDirect: 9, alcohol: 0, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 15 },
  { id: "fruit-banana", cat: "fruit", name: "Banana", water: 80, fat: 0, msnf: 20, otherSolids: 0, sugars: {}, podDirect: 0, pacDirect: 20, alcohol: 0, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 15 },
  { id: "fruit-pineapple", cat: "fruit", name: "Abacaxi", water: 87, fat: 0, msnf: 13, otherSolids: 0, sugars: {}, podDirect: 0, pacDirect: 13, alcohol: 0, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 15 },
  { id: "fruit-peach", cat: "fruit", name: "Pêssego", water: 89, fat: 0, msnf: 11, otherSolids: 0, sugars: {}, podDirect: 0, pacDirect: 11, alcohol: 0, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 15 },
  { id: "fruit-pear", cat: "fruit", name: "Pera", water: 87, fat: 0, msnf: 13, otherSolids: 0, sugars: {}, podDirect: 0, pacDirect: 13, alcohol: 0, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 15 },
  { id: "fruit-apple", cat: "fruit", name: "Maçã", water: 88, fat: 0, msnf: 12, otherSolids: 0, sugars: {}, podDirect: 0, pacDirect: 12, alcohol: 0, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 15 },
  { id: "fruit-mango2", cat: "fruit", name: "Manga", water: 90, fat: 0, msnf: 10, otherSolids: 0, sugars: {}, podDirect: 0, pacDirect: 10, alcohol: 0, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 15 },
  { id: "fruit-strawberry", cat: "fruit", name: "Morango", water: 92, fat: 0, msnf: 8, otherSolids: 0, sugars: {}, podDirect: 0, pacDirect: 8, alcohol: 0, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 15 },
  { id: "fruit-raspberry", cat: "fruit", name: "Framboesa", water: 92, fat: 0, msnf: 8, otherSolids: 0, sugars: {}, podDirect: 0, pacDirect: 8, alcohol: 0, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 15 },
  { id: "fruit-blackberry", cat: "fruit", name: "Amora", water: 88, fat: 0, msnf: 12, otherSolids: 0, sugars: {}, podDirect: 0, pacDirect: 12, alcohol: 0, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 15 },
  { id: "fruit-apricot", cat: "fruit", name: "Damasco", water: 88, fat: 0, msnf: 12, otherSolids: 0, sugars: {}, podDirect: 0, pacDirect: 12, alcohol: 0, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 15 },
  { id: "fruit-passionfruit", cat: "fruit", name: "Maracujá", water: 93, fat: 0, msnf: 7, otherSolids: 0, sugars: {}, podDirect: 0, pacDirect: 7, alcohol: 0, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 15 },
  { id: "fruit-cherry", cat: "fruit", name: "Cereja", water: 86, fat: 0, msnf: 14, otherSolids: 0, sugars: {}, podDirect: 0, pacDirect: 14, alcohol: 0, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 15 },
  { id: "fruit-blueberry", cat: "fruit", name: "Mirtilo", water: 92, fat: 0, msnf: 8, otherSolids: 0, sugars: {}, podDirect: 0, pacDirect: 8, alcohol: 0, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 15 },
  { id: "fruit-watermelon", cat: "fruit", name: "Melancia", water: 94, fat: 0, msnf: 6, otherSolids: 0, sugars: {}, podDirect: 0, pacDirect: 6, alcohol: 0, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 15 },
  { id: "fruit-fig", cat: "fruit", name: "Figo", water: 86, fat: 0, msnf: 14, otherSolids: 0, sugars: {}, podDirect: 0, pacDirect: 14, alcohol: 0, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 15 },
  { id: "fruit-kiwi", cat: "fruit", name: "Kiwi", water: 92, fat: 0, msnf: 8, otherSolids: 0, sugars: {}, podDirect: 0, pacDirect: 8, alcohol: 0, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 15 },
  { id: "fruit-papaya", cat: "fruit", name: "Mamão papaia", water: 92, fat: 0, msnf: 8, otherSolids: 0, sugars: {}, podDirect: 0, pacDirect: 8, alcohol: 0, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 15 },
  { id: "fruit-grape", cat: "fruit", name: "Uva", water: 84, fat: 0, msnf: 16, otherSolids: 0, sugars: {}, podDirect: 0, pacDirect: 16, alcohol: 0, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 15 },
  { id: "cocoa-22", cat: "main", name: "Cacau em pó", water: 0, fat: 22, msnf: 0, otherSolids: 78, sugars: {}, podDirect: 0, pacDirect: 160, alcohol: 0, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 35 },
  { id: "cocoa-butter", cat: "main", name: "Manteiga de cacau", water: 0, fat: 100, msnf: 0, otherSolids: 0, sugars: {}, podDirect: 0, pacDirect: -90, alcohol: 0, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 15 },
  { id: "chocolate-70", cat: "main", name: "Cobertura 70% cacau", water: 0, fat: 42, msnf: 0, otherSolids: 58, sugars: {}, podDirect: 30, pacDirect: -58, alcohol: 0, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 15 },
  { id: "chocolate-65", cat: "main", name: "Cobertura 65% cacau", water: 0, fat: 40, msnf: 0, otherSolids: 60, sugars: {}, podDirect: 35, pacDirect: 46, alcohol: 0, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 15 },
  { id: "chocolate-60", cat: "main", name: "Cobertura 60% cacau", water: 0, fat: 38, msnf: 0, otherSolids: 62, sugars: {}, podDirect: 40, pacDirect: -34, alcohol: 0, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 15 },
  { id: "chocolate-55", cat: "main", name: "Cobertura 55% cacau", water: 0, fat: 35, msnf: 0, otherSolids: 65, sugars: {}, podDirect: 45, pacDirect: -23, alcohol: 0, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 15 },
  { id: "chocolate-milk-40", cat: "main", name: "Cobertura ao leite 40%", water: 0, fat: 41, msnf: 19, otherSolids: 40, sugars: {}, podDirect: 35, pacDirect: 4, alcohol: 0, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 15 },
  { id: "chocolate-white", cat: "main", name: "Chocolate branco", water: 0, fat: 40, msnf: 15, otherSolids: 45, sugars: {}, podDirect: 45, pacDirect: 25, alcohol: 0, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 15 },
  { id: "paste-hazelnut", cat: "semi", name: "Pasta de avelã", water: 0, fat: 65, msnf: 0, otherSolids: 35, sugars: {}, podDirect: 0, pacDirect: -91, alcohol: 0, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 120 },
  { id: "paste-almond", cat: "semi", name: "Pasta de amêndoa", water: 0, fat: 60, msnf: 0, otherSolids: 40, sugars: {}, podDirect: 0, pacDirect: -84, alcohol: 0, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 15 },
  { id: "paste-walnut", cat: "semi", name: "Pasta de noz", water: 0, fat: 64, msnf: 0, otherSolids: 36, sugars: {}, podDirect: 0, pacDirect: -90, alcohol: 0, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 15 },
  { id: "paste-pinenut", cat: "semi", name: "Pasta de pinhão", water: 0, fat: 62, msnf: 0, otherSolids: 38, sugars: {}, podDirect: 0, pacDirect: -87, alcohol: 0, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 15 },
  { id: "paste-pistachio", cat: "semi", name: "Pasta de pistache", water: 0, fat: 50, msnf: 0, otherSolids: 50, sugars: {}, podDirect: 0, pacDirect: -70, alcohol: 0, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 180 },
  { id: "paste-nougat", cat: "semi", name: "Pasta de torrone 50% amêndoa", water: 0, fat: 30, msnf: 0, otherSolids: 70, sugars: {}, podDirect: 40, pacDirect: -2, alcohol: 0, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 15 },
  { id: "paste-peanut", cat: "semi", name: "Pasta de amendoim", water: 0, fat: 50, msnf: 0, otherSolids: 50, sugars: {}, podDirect: 0, pacDirect: -70, alcohol: 0, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 15 },
  { id: "salt", cat: "other", name: "Sal", water: 0, fat: 0, msnf: 0, otherSolids: 100, sugars: {}, podDirect: 0, pacDirect: 100, alcohol: 0, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 3 },
  { id: "veg-tomato", cat: "fruit", name: "Tomate", water: 86, fat: 0, msnf: 3, otherSolids: 11, sugars: {}, podDirect: 0, pacDirect: 2, alcohol: 0, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 15 },
  { id: "veg-carrot", cat: "fruit", name: "Cenoura", water: 90, fat: 0, msnf: 6, otherSolids: 4, sugars: {}, podDirect: 0, pacDirect: 3, alcohol: 0, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 15 },
  { id: "veg-celery", cat: "fruit", name: "Aipo", water: 90, fat: 0, msnf: 1, otherSolids: 9, sugars: {}, podDirect: 0, pacDirect: 1, alcohol: 0, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 15 },
  { id: "veg-fennel", cat: "fruit", name: "Funcho", water: 94, fat: 0, msnf: 2, otherSolids: 4, sugars: {}, podDirect: 0, pacDirect: 1, alcohol: 0, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 15 },
  { id: "veg-cucumber", cat: "fruit", name: "Pepino", water: 96, fat: 0, msnf: 2, otherSolids: 2, sugars: {}, podDirect: 0, pacDirect: 1, alcohol: 0, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 15 },
  { id: "veg-pepper", cat: "fruit", name: "Pimentão vermelho", water: 94, fat: 0, msnf: 1, otherSolids: 5, sugars: {}, podDirect: 0, pacDirect: 1, alcohol: 0, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 15 },
  { id: "cheese-roquefort", cat: "other", name: "Queijo roquefort", water: 45, fat: 32, msnf: 23, otherSolids: 0, sugars: {}, podDirect: 0, pacDirect: 0, alcohol: 0, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 15 },
  { id: "cheese-manchego", cat: "other", name: "Queijo manchego curado", water: 35, fat: 32, msnf: 33, otherSolids: 0, sugars: {}, podDirect: 0, pacDirect: 0, alcohol: 0, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 15 },
  { id: "cheese-cabrales", cat: "other", name: "Queijo cabrales", water: 44, fat: 33, msnf: 23, otherSolids: 0, sugars: {}, podDirect: 0, pacDirect: 0, alcohol: 0, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 15 },
  { id: "cheese-parmesan", cat: "other", name: "Queijo parmesão", water: 29, fat: 28, msnf: 43, otherSolids: 0, sugars: {}, podDirect: 0, pacDirect: 0, alcohol: 0, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 15 },
  { id: "cheese-gorgonzola", cat: "other", name: "Gorgonzola", water: 29, fat: 29, msnf: 28, otherSolids: 14, sugars: {}, podDirect: 0, pacDirect: 0, alcohol: 0, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 15 },
  { id: "foie-gras", cat: "other", name: "Foie gras mi-cuit", water: 39, fat: 42, msnf: 0, otherSolids: 19, sugars: {}, podDirect: 0, pacDirect: 0, alcohol: 0, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 15 },
  { id: "smoked-salmon", cat: "other", name: "Salmão defumado", water: 69, fat: 12, msnf: 0, otherSolids: 19, sugars: {}, podDirect: 0, pacDirect: 0, alcohol: 0, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 15 },
  { id: "caviar", cat: "other", name: "Caviar", water: 57, fat: 16, msnf: 0, otherSolids: 27, sugars: {}, podDirect: 0, pacDirect: 0, alcohol: 0, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 15 },
  { id: "anchovies", cat: "other", name: "Anchovas", water: 66, fat: 13, msnf: 0, otherSolids: 21, sugars: {}, podDirect: 0, pacDirect: 0, alcohol: 0, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 15 },
  { id: "herring", cat: "other", name: "Arenque salgado", water: 48, fat: 16, msnf: 0, otherSolids: 36, sugars: {}, podDirect: 0, pacDirect: 0, alcohol: 0, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 15 },
  { id: "mushrooms", cat: "other", name: "Cogumelos", water: 91, fat: 2, msnf: 0, otherSolids: 7, sugars: {}, podDirect: 0, pacDirect: 0, alcohol: 0, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 15 },
  { id: "cured-ham", cat: "other", name: "Presunto cru ibérico", water: 49, fat: 19, msnf: 0, otherSolids: 32, sugars: {}, podDirect: 0, pacDirect: 0, alcohol: 0, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 15 },
  { id: "prawns", cat: "other", name: "Camarão", water: 80, fat: 2, msnf: 0, otherSolids: 18, sugars: {}, podDirect: 0, pacDirect: 0, alcohol: 0, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 15 },
  { id: "sea-urchin", cat: "other", name: "Ouriço-do-mar", water: 81, fat: 6, msnf: 0, otherSolids: 13, sugars: {}, podDirect: 0, pacDirect: 0, alcohol: 0, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 15 },
{ id: "agave", cat: "sweet-natural", name: "Xarope de agave", water: 24, fat: 0, msnf: 0, otherSolids: 0, sugars: { fructose: 56, glucose62DE: 20 }, podDirect: 0, pacDirect: 0, alcohol: 0, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 22 },
  { id: "basil", cat: "main", name: "Manjericão", water: 92, fat: 0.6, msnf: 0, otherSolids: 7.4, sugars: {}, podDirect: 0, pacDirect: 0, alcohol: 0, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 30 },
  { id: "brandy", cat: "alcohol", name: "Brandy 40°", water: 60, fat: 0, msnf: 0, otherSolids: 0, sugars: {}, podDirect: 0, pacDirect: 148, alcohol: 0, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 45 },
  { id: "burrata", cat: "dairy", name: "Burrata", water: 60, fat: 28, msnf: 6, otherSolids: 4, sugars: {}, podDirect: 0, pacDirect: 8, alcohol: 0, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 40 },
  { id: "butter", cat: "dairy", name: "Manteiga", water: 16, fat: 82, msnf: 1.5, otherSolids: 0, sugars: {}, podDirect: 0, pacDirect: -20, alcohol: 0, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 45 },
  { id: "chocolate-80", cat: "main", name: "Chocolate 80%", water: 1, fat: 46, msnf: 0, otherSolids: 33, sugars: { sucrose: 20 }, podDirect: 0, pacDirect: 0, alcohol: 0, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 60 },
  { id: "cookie-oreo", cat: "nuts", name: "Biscoito/crocante", water: 3, fat: 22, msnf: 0, otherSolids: 45, sugars: { sucrose: 30 }, podDirect: 0, pacDirect: 0, alcohol: 0, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 28 },
  { id: "erythritol", cat: "sweet-other", name: "Eritritol", water: 0, fat: 0, msnf: 0, otherSolids: 100, sugars: {}, podDirect: 70, pacDirect: 280, alcohol: 0, clean: true, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 30 },
  { id: "fruit-avocado", cat: "fruit", name: "Abacate", water: 73, fat: 15, msnf: 0, otherSolids: 11, sugars: {}, podDirect: 0, pacDirect: 0, alcohol: 0, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 12 },
  { id: "fruit-kumquat", cat: "fruit", name: "Kumquat", water: 80, fat: 0.9, msnf: 0, otherSolids: 9, sugars: {}, podDirect: 0, pacDirect: 9, alcohol: 0, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 25 },
  { id: "fruit-melon", cat: "fruit", name: "Melão", water: 90, fat: 0.2, msnf: 0, otherSolids: 8, sugars: {}, podDirect: 0, pacDirect: 8, alcohol: 0, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 6 },
  { id: "ginger", cat: "main", name: "Gengibre", water: 79, fat: 0.8, msnf: 0, otherSolids: 18, sugars: {}, podDirect: 0, pacDirect: 0, alcohol: 0, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 14 },
  { id: "glucose-62", cat: "sugar", name: "Xarope glucose 62 DE", water: 20, fat: 0, msnf: 0, otherSolids: 0, sugars: { glucose62DE: 80 }, podDirect: 0, pacDirect: 0, alcohol: 0, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 7 },
  { id: "glucose-atom-38", cat: "sugar", name: "Glucose atomizada 38 DE", water: 0, fat: 0, msnf: 0, otherSolids: 0, sugars: { glucose38DE: 100 }, podDirect: 0, pacDirect: 0, alcohol: 0, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 8 },
  { id: "greek-yogurt", cat: "dairy", name: "Iogurte grego", water: 81, fat: 5, msnf: 9, otherSolids: 0, sugars: { lactose: 4 }, podDirect: 0, pacDirect: 5, alcohol: 0, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 16 },
  { id: "inulin", cat: "neutral", name: "Inulina (fibra, clean label)", water: 5, fat: 0, msnf: 0, otherSolids: 95, sugars: {}, podDirect: 0, pacDirect: 0, alcohol: 0, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 45 },
  { id: "lemon-zest", cat: "fruit", name: "Raspas de cítrico", water: 60, fat: 0.3, msnf: 0, otherSolids: 39.7, sugars: {}, podDirect: 0, pacDirect: 0, alcohol: 0, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 15 },
  { id: "liqueur", cat: "alcohol", name: "Licor 30°", water: 40, fat: 0, msnf: 0, otherSolids: 0, sugars: { sucrose: 30 }, podDirect: 0, pacDirect: 111, alcohol: 30, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 50 },
  { id: "maltitol", cat: "sweet-other", name: "Maltitol", clean: true, water: 0, fat: 0, msnf: 0, otherSolids: 10, sugars: { sucrose: 90 }, podDirect: 0, pacDirect: 0, alcohol: 0, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 25 },
  { id: "maltodextrin-18", cat: "sugar", name: "Maltodextrina 18 DE", water: 0, fat: 0, msnf: 0, otherSolids: 100, sugars: {}, podDirect: 0, pacDirect: 0, alcohol: 0, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 12 },
  { id: "marsala", cat: "alcohol", name: "Marsala 18°", water: 70, fat: 0, msnf: 0, otherSolids: 8, sugars: { sucrose: 4 }, podDirect: 0, pacDirect: 67, alcohol: 18, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 35 },
  { id: "mascarpone", cat: "dairy", name: "Mascarpone", water: 52, fat: 42, msnf: 4, otherSolids: 0, sugars: { lactose: 2 }, podDirect: 0, pacDirect: 2, alcohol: 0, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 48 },
  { id: "mint", cat: "main", name: "Hortelã", water: 86, fat: 0.9, msnf: 0, otherSolids: 13, sugars: {}, podDirect: 0, pacDirect: 0, alcohol: 0, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 30 },
  { id: "neutral-sorbet", cat: "neutral", name: "Neutro p/ sorbet", water: 0, fat: 0, msnf: 0, otherSolids: 100, sugars: {}, podDirect: 0, pacDirect: 0, alcohol: 0, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 62 },
  { id: "nut-almond", cat: "nuts", name: "Amêndoa picada", water: 4, fat: 50, msnf: 0, otherSolids: 42, sugars: { sucrose: 4 }, podDirect: 0, pacDirect: 0, alcohol: 0, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 70 },
  { id: "nut-pistachio", cat: "nuts", name: "Pistache picado", water: 4, fat: 45, msnf: 0, otherSolids: 44, sugars: { sucrose: 7 }, podDirect: 0, pacDirect: 0, alcohol: 0, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 160 },
  { id: "olive-oil", cat: "other", name: "Azeite de oliva", water: 0, fat: 100, msnf: 0, otherSolids: 0, sugars: {}, podDirect: 0, pacDirect: -20, alcohol: 0, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 40 },
  { id: "paste-sesame", cat: "semi", name: "Pasta de gergelim", water: 3, fat: 55, msnf: 0, otherSolids: 38, sugars: { sucrose: 4 }, podDirect: 0, pacDirect: -70, alcohol: 0, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 60 },
  { id: "praline", cat: "semi", name: "Praliné / Nutella", water: 4, fat: 30, msnf: 0, otherSolids: 16, sugars: { sucrose: 50 }, podDirect: 0, pacDirect: 0, alcohol: 0, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 90 },
  { id: "raisin", cat: "fruit", name: "Uva passa", water: 15, fat: 0.5, msnf: 0, otherSolids: 5.5, sugars: { fructose: 39, glucose62DE: 40 }, podDirect: 0, pacDirect: 0, alcohol: 0, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 18 },
  { id: "ricotta", cat: "dairy", name: "Ricotta", water: 73, fat: 13, msnf: 9, otherSolids: 0, sugars: { lactose: 3 }, podDirect: 0, pacDirect: 3, alcohol: 0, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 22 },
  { id: "rum", cat: "alcohol", name: "Rum 40°", water: 60, fat: 0, msnf: 0, otherSolids: 0, sugars: {}, podDirect: 0, pacDirect: 148, alcohol: 40, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 40 },
  { id: "trehalose", cat: "sweet-other", name: "Trealose", water: 0, fat: 0, msnf: 0, otherSolids: 0, sugars: { sucrose: 45 }, podDirect: 0, pacDirect: 0, alcohol: 0, clean: true, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 35 },
  { id: "allulose", cat: "sweet-other", name: "Alulose", water: 0, fat: 0, msnf: 0, otherSolids: 0, sugars: { glucose62DE: 70 }, podDirect: 70, pacDirect: 190, alcohol: 0, clean: true, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 55 },
  { id: "stevia", cat: "sweet-natural", name: "Stevia", water: 0, fat: 0, msnf: 0, otherSolids: 100, sugars: {}, podDirect: 20000, pacDirect: 0, alcohol: 0, clean: true, intense: true, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 400 },
  { id: "monkfruit", cat: "sweet-natural", name: "Monk fruit", water: 0, fat: 0, msnf: 0, otherSolids: 100, sugars: {}, podDirect: 20000, pacDirect: 0, alcohol: 0, clean: true, intense: true, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 450 },
  { id: "vanilla", cat: "main", name: "Pasta de baunilha", water: 35, fat: 0, msnf: 0, otherSolids: 35, sugars: { sucrose: 30 }, podDirect: 0, pacDirect: 0, alcohol: 0, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 220 },
  { id: "vodka", cat: "alcohol", name: "Vodka/Gin 40°", water: 60, fat: 0, msnf: 0, otherSolids: 0, sugars: {}, podDirect: 0, pacDirect: 148, alcohol: 40, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 35 },
  { id: "wine-white", cat: "alcohol", name: "Vinho/espumante 12°", water: 86, fat: 0, msnf: 0, otherSolids: 2, sugars: {}, podDirect: 0, pacDirect: 44, alcohol: 12, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 25 },
];
const FAMILIES = [
  { id: "cream", label: "Creme branco", author: "Corvitto", locked: true },
  { id: "yogurt", label: "Creme de iogurte", author: "Corvitto", locked: true },
  { id: "yolk", label: "Creme de gema", author: "Corvitto", locked: true },
  { id: "fruitCream", label: "Creme de fruta", author: "Corvitto", locked: true },
  { id: "chocolate", label: "Creme de chocolate", author: "Corvitto", locked: true },
  { id: "nuts", label: "Creme de frutos secos", author: "Corvitto", locked: true },
  { id: "teaSpiceCream", label: "Creme de chá/especiarias", author: "Corvitto", locked: true },
  { id: "liquorCream", label: "Creme de licor", author: "Corvitto", locked: true },
  { id: "savory", label: "Creme salgado", author: "Corvitto", locked: true },
  { id: "sorbetFruit", label: "Sorbet de fruta", author: "Corvitto", locked: true },
  { id: "sorbetCitrus", label: "Sorbet cítrico", author: "CucinaLi", locked: true },
  { id: "teaSpiceSorbet", label: "Sorbet de chá/especiarias", author: "Corvitto", locked: true },
  { id: "sorbetAlcohol", label: "Sorbet de licor", author: "Corvitto", locked: true },
  { id: "savorySorbet", label: "Sorbet salgado", author: "Corvitto", locked: true },
];
const PARAM_LABELS = [["sugars","Açúcares","%"],["fat","Gorduras","%"],["msnf","SLNG","%"],["other","Outros sólidos","%"],["neutro","Neutros","%"],["solids","Sólidos totais","%"],["pod","POD",""],["fruit","Frutas","%"],["alcohol","Álcool","%"],["chopped","Picados","%"]];
// Agrupa as 14 famílias técnicas em grupos amplos para o filtro da biblioteca.
const FAMILY_GROUP = {
  cream: "Cremes", yogurt: "Cremes", yolk: "Cremes", savory: "Cremes", teaSpiceCream: "Cremes", savorySorbet: "Cremes",
  fruitCream: "Frutas", sorbetFruit: "Frutas",
  sorbetCitrus: "Cítricos",
  chocolate: "Chocolate",
  nuts: "Frutas secas",
  liquorCream: "Alcoólicos", sorbetAlcohol: "Alcoólicos", teaSpiceSorbet: "Funcionais",
};
const FAMILY_GROUPS = ["Cremes", "Frutas", "Cítricos", "Chocolate", "Frutas secas", "Alcoólicos", "Funcionais"];
const TEMPS = [-8, -9, -10, -11, -12, -13, -14, -15, -16, -17, -18];
// Equipamentos e a temperatura de serviço típica em que se balanceia para cada um.
// Base: gelato sai da mantecadora p/ vitrine ~-11°C; Pacojet/Ninja saem ~-9°C; freezer caseiro mais frio.
const EQUIPMENT = [
  { id: "tradicional", label: "Gelateria tradicional (mantecadora)", temp: -11, note: "Servido em vitrine a cerca de -11°C." },
  { id: "pacojet", label: "Pacojet", temp: -9, note: "Sai do Pacojet a ~-6°C; balanceia-se em torno de -9°C para ficar cremoso na hora." },
  { id: "ninja", label: "Ninja Creami", temp: -9, note: "Mesma lógica do Pacojet: balanceia para a temperatura de saída da máquina." },
  { id: "caseiro", label: "Freezer doméstico (sem máquina)", temp: -16, note: "Sem mantecadora, o gelato fica mais firme; balanceie mais mole (PAC alto) para conseguir servir." },
];
const WEIGHTS = [1000, 2500, 5000, 10000];
const ing = (id) => INGREDIENTS.find((x) => x.id === id);
const STARTER = [
  { ingredient: ing("milk-whole"), grams: 567 }, { ingredient: ing("cream-35"), grams: 172 },
  { ingredient: ing("smp"), grams: 42 }, { ingredient: ing("dextrose"), grams: 137 },
  { ingredient: ing("inverted"), grams: 26 }, { ingredient: ing("sucrose"), grams: 50 },
  { ingredient: ing("stabilizer"), grams: 6 },
];
const PRELOADED = []; // receitas começam vazias — o acervo é construído pelo usuário
// ============================================================================
// TEMA CLARO — paleta de gelataria (creme, menta, morango suave)
// ============================================================================
const T = {
  bg: "#f6f1e8", card: "#ffffff", line: "#e7dccb", ink: "#2b2620", soft: "#9a9082",
  // ouro como acento principal (botões ativos, títulos, destaques)
  gold: "#b08d3f", goldSoft: "#c9a85e", goldBg: "#f5ecd8", goldLine: "#e3d2a8",
  mint: "#5fa98f", mintBg: "#e9f3ee", straw: "#c98b6b", strawBg: "#f6ece4",
  sun: "#c89a3e", sunBg: "#f7eed6", blue: "#6f95bf", blueBg: "#eaf0f7",
};
const MONCOLOR = {
  in: { fill: "#1a7d54", bg: "#c8f0dc", label: "OK" },
  below: { fill: "#9a6500", bg: "#ffe39c", label: "BAIXO" },
  above: { fill: "#c01f2f", bg: "#ffd2d2", label: "ALTO" },
  na: { fill: "#a59a86", bg: "#efe9dd", label: "—" },
};
const KINDS = ["Gelato", "Sorbetto", "Ghiacciolo", "Granita"];
const fmt2 = (n) => (n === 0 || n == null ? "—" : round(n).toLocaleString("pt-BR"));

function Pill({ active, onClick, children }) {
  return <button onClick={onClick} style={{ background: active ? T.gold : "#fff", color: active ? "#fff" : T.soft, border: `1px solid ${active ? T.gold : T.line}`, borderRadius: 20, padding: "7px 14px", fontSize: 13, fontWeight: 500, cursor: "pointer", transition: "all .15s", boxShadow: active ? "0 2px 8px rgba(176,141,63,.25)" : "none" }}>{children}</button>;
}

// ---- Aba de Famílias: padrões de referência dos parâmetros de controle ----
function FamiliesTab({ fams, version, onCreate, onDuplicate, onDelete, onSetParam, onRename, onUse }) {
  const [open, setOpen] = useState(null); // família expandida
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [baseId, setBaseId] = useState("cream");
  const authors = [...new Set(fams.map((f) => f.author || "Autoral"))];
  const fmtRange = (r) => r == null ? "—" : `${r[0]}–${r[1]}`;
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 6, flexWrap: "wrap", gap: 10 }}>
        <div>
          <div style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 24, fontWeight: 600, color: T.ink }}>Famílias e seus padrões</div>
          <div style={{ fontSize: 13, color: T.soft, marginTop: 2, maxWidth: 620 }}>As faixas de cada família são a referência dos parâmetros de controle na formulação. As famílias de autor (Corvitto e outros) são travadas — servem de referência. As autorais você cria, edita e duplica.</div>
        </div>
        <button onClick={() => setCreating((v) => !v)} style={{ background: T.gold, color: "#fff", border: "none", borderRadius: 10, padding: "10px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>+ nova família</button>
      </div>

      {creating && (
        <div style={{ background: "#fff", border: `1px solid ${T.goldLine}`, borderRadius: 14, padding: 16, margin: "12px 0", display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
          <label style={{ flex: 1, minWidth: 200 }}><span style={{ display: "block", fontSize: 11, color: T.soft, marginBottom: 4 }}>Nome da nova família</span>
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="ex: Creme de caramelo salgado" style={inp} /></label>
          <label style={{ minWidth: 200 }}><span style={{ display: "block", fontSize: 11, color: T.soft, marginBottom: 4 }}>Basear as faixas em</span>
            <select value={baseId} onChange={(e) => setBaseId(e.target.value)} style={sel}>{fams.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}</select></label>
          <button onClick={() => { if (newName.trim()) { const id = onCreate(newName.trim(), baseId); setNewName(""); setCreating(false); setOpen(id); } }} style={{ background: T.gold, color: "#fff", border: "none", borderRadius: 10, padding: "10px 18px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Criar</button>
          <button onClick={() => setCreating(false)} style={{ background: "none", color: T.soft, border: "none", padding: "10px 8px", fontSize: 13, cursor: "pointer" }}>Cancelar</button>
        </div>
      )}

      {authors.map((author) => (
        <div key={author} style={{ marginTop: 18 }}>
          <div style={{ fontSize: 11, letterSpacing: 1, textTransform: "uppercase", color: T.goldSoft, fontWeight: 700, marginBottom: 8 }}>{author === "Autoral" ? "Minhas famílias (autorais)" : `Linha ${author}`}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {fams.filter((f) => (f.author || "Autoral") === author).map((f) => {
              const P = FAMILY_PARAMS[f.id] || {}; const isOpen = open === f.id;
              return (
                <div key={f.id} style={{ background: "#fff", border: `1px solid ${T.line}`, borderRadius: 14, overflow: "hidden" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", cursor: "pointer" }} onClick={() => setOpen(isOpen ? null : f.id)}>
                    <span style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 15.5, fontWeight: 600, color: T.ink }}>{f.label}</span>
                    {f.locked ? <span style={{ fontSize: 9.5, background: T.bg, color: T.soft, padding: "2px 8px", borderRadius: 20, fontWeight: 600, border: `1px solid ${T.line}` }}>🔒 referência</span>
                             : <span style={{ fontSize: 9.5, background: "#e9f3ee", color: "#1a7d54", padding: "2px 8px", borderRadius: 20, fontWeight: 700 }}>editável</span>}
                    <span style={{ marginLeft: "auto", fontSize: 18, color: T.soft }}>{isOpen ? "▾" : "▸"}</span>
                  </div>
                  {isOpen && (
                    <div style={{ padding: "4px 16px 16px", borderTop: `1px solid ${T.bg}` }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 8 }}>
                        <thead><tr><th style={{ textAlign: "left", fontSize: 10, textTransform: "uppercase", color: T.soft, padding: "6px 4px", letterSpacing: 0.5 }}>Parâmetro</th><th style={{ textAlign: "right", fontSize: 10, textTransform: "uppercase", color: T.soft, padding: "6px 4px" }}>Mínimo</th><th style={{ textAlign: "right", fontSize: 10, textTransform: "uppercase", color: T.soft, padding: "6px 4px" }}>Máximo</th></tr></thead>
                        <tbody>
                          {PARAM_LABELS.map(([key, label, unit]) => {
                            const rng = P[key];
                            return (
                              <tr key={key} style={{ borderTop: `1px solid ${T.bg}` }}>
                                <td style={{ padding: "7px 4px", fontSize: 13, color: rng == null ? "#c4bdb2" : T.ink }}>{label}{rng == null ? <span style={{ fontSize: 11, fontStyle: "italic" }}> — não se aplica</span> : ""}</td>
                                <td style={{ textAlign: "right", padding: "5px 4px" }}>{rng == null ? <span style={{ color: "#c4bdb2" }}>—</span> : f.locked ? <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 13 }}>{rng[0]}{unit}</span> : <input type="number" value={rng[0]} onChange={(e) => onSetParam(f.id, key, 0, e.target.value)} style={{ width: 56, ...inp, padding: "4px 6px", fontFamily: "'DM Mono', monospace", fontSize: 12.5, textAlign: "right" }} />}</td>
                                <td style={{ textAlign: "right", padding: "5px 4px" }}>{rng == null ? <span style={{ color: "#c4bdb2" }}>—</span> : f.locked ? <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 13 }}>{rng[1]}{unit}</span> : <input type="number" value={rng[1]} onChange={(e) => onSetParam(f.id, key, 1, e.target.value)} style={{ width: 56, ...inp, padding: "4px 6px", fontFamily: "'DM Mono', monospace", fontSize: 12.5, textAlign: "right" }} />}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                      <div style={{ fontSize: 11, color: T.soft, marginTop: 8, fontStyle: "italic" }}>PAC não aparece aqui: ele vem da temperatura de serviço (tabela do Corvitto), ajustável em qualquer família.</div>
                      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                        <button onClick={() => onUse(f.id)} style={{ background: T.goldBg, color: T.gold, border: `1px solid ${T.goldLine}`, borderRadius: 9, padding: "8px 14px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>Usar na formulação</button>
                        <button onClick={() => onDuplicate(f.id)} style={{ background: "#fff", color: T.ink, border: `1px solid ${T.line}`, borderRadius: 9, padding: "8px 14px", fontSize: 12.5, cursor: "pointer" }}>Duplicar{f.locked ? " (para editar)" : ""}</button>
                        {!f.locked && <button onClick={() => onDelete(f.id)} style={{ background: "none", color: "#c01f2f", border: "none", padding: "8px 10px", fontSize: 12.5, cursor: "pointer", marginLeft: "auto" }}>Excluir</button>}
                      </div>
                      {f.locked && <div style={{ fontSize: 11.5, color: T.soft, marginTop: 8 }}>Esta é uma família de referência ({f.author}) e não pode ser alterada. Para criar sua versão, use <b>Duplicar</b> — a cópia fica editável e não afeta a original.</div>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---- Biblioteca com filtros ----
function Library({ saved, onOpen, onDelete, famLabel }) {
  const [cat, setCat] = useState("Todas");
  const [group, setGroup] = useState("Todas");
  const [lib, setLib] = useState("Todas");
  const [equip, setEquip] = useState("Todos");
  const [nutri, setNutri] = useState("Todos");
  const [q, setQ] = useState("");
  const libs = ["Todas", ...new Set(saved.map((s) => s.school || "CucinaLi"))];
  const eqLabel = (id) => EQUIPMENT.find((e) => e.id === id)?.label || "Gelateria tradicional (mantecadora)";
  const eqShort = (id) => eqLabel(id).replace(/ \(.*\)/, "");
  const tagsOf = (s) => nutriTags(s.items, INGREDIENTS);
  const filtered = saved.filter((s) =>
    (cat === "Todas" || s.kind === cat) &&
    (group === "Todas" || FAMILY_GROUP[s.family] === group) &&
    (lib === "Todas" || (s.school || "CucinaLi") === lib) &&
    (equip === "Todos" || (s.equipment || "tradicional") === equip) &&
    (nutri === "Todos" || tagsOf(s).includes(nutri)) &&
    (!q || s.name.toLowerCase().includes(q.toLowerCase()))
  );
  const libColor = (a) => a === "Corvitto" ? { bg: "#f3ecda", fg: "#8a6d1e" } : a === "CucinaLi" ? { bg: "#eaf1f8", fg: "#3f6ea5" } : { bg: "#eef0ea", fg: "#5f6a4a" };
  const tagColor = (t) => {
    if (t === "Vegano") return { bg: "#eaf3e4", fg: "#4a7a2a" };
    if (t === "Sem açúcar adicionado" || t === "Low sugar" || t === "Keto") return { bg: "#f3ecf6", fg: "#7a4a8a" };
    if (t === "Rico em fibras") return { bg: "#eaf1f8", fg: "#3f6ea5" };
    if (t === "Proteico") return { bg: "#fdeede", fg: "#b06a1e" };
    return { bg: T.bg, fg: T.soft };
  };
  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 24, fontWeight: 600, color: T.ink, marginBottom: 12 }}>Biblioteca de receitas</div>
        <input placeholder="Buscar receita pelo nome…" value={q} onChange={(e) => setQ(e.target.value)}
          style={{ width: "100%", boxSizing: "border-box", background: "#fff", border: `1px solid ${T.line}`, borderRadius: 12, color: T.ink, padding: "12px 16px", fontSize: 14, outline: "none", marginBottom: 14 }} />
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <FilterGroup label="Biblioteca"><Pill active={lib === "Todas"} onClick={() => setLib("Todas")}>Todas</Pill>{libs.filter((a) => a !== "Todas").map((a) => <Pill key={a} active={lib === a} onClick={() => setLib(a)}>{a}</Pill>)}</FilterGroup>
          <FilterGroup label="Equipamento"><Pill active={equip === "Todos"} onClick={() => setEquip("Todos")}>Todos</Pill>{EQUIPMENT.map((e) => <Pill key={e.id} active={equip === e.id} onClick={() => setEquip(e.id)}>{eqShort(e.id)}</Pill>)}</FilterGroup>
          <FilterGroup label="Categoria"><Pill active={cat === "Todas"} onClick={() => setCat("Todas")}>Todas</Pill>{KINDS.map((k) => <Pill key={k} active={cat === k} onClick={() => setCat(k)}>{k}</Pill>)}</FilterGroup>
          <FilterGroup label="Família"><Pill active={group === "Todas"} onClick={() => setGroup("Todas")}>Todas</Pill>{FAMILY_GROUPS.map((g) => <Pill key={g} active={group === g} onClick={() => setGroup(g)}>{g}</Pill>)}</FilterGroup>
          <FilterGroup label="Perfil nutricional"><Pill active={nutri === "Todos"} onClick={() => setNutri("Todos")}>Todos</Pill>{["Tradicional", "Low sugar", "Sem açúcar adicionado", "Proteico", "Rico em fibras", "Keto", "Vegano"].map((n) => <Pill key={n} active={nutri === n} onClick={() => setNutri(n)}>{n}</Pill>)}</FilterGroup>
        </div>
      </div>
      <div style={{ fontSize: 12.5, color: T.soft, marginBottom: 12 }}>{filtered.length} receita{filtered.length !== 1 ? "s" : ""} encontrada{filtered.length !== 1 ? "s" : ""}</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: 16 }}>
        {filtered.slice(0, 60).map((s) => {
          const lc = libColor(s.school || "CucinaLi");
          const tags = tagsOf(s);
          return (
          <div key={s.id} style={{ background: "#fff", border: `1px solid ${T.line}`, borderRadius: 18, overflow: "hidden", boxShadow: "0 2px 10px rgba(60,58,54,.05)", display: "flex", flexDirection: "column" }}>
            {s.photo ? <img src={s.photo} alt={s.name} style={{ width: "100%", height: 150, objectFit: "cover", display: "block" }} />
                     : <div style={{ height: 110, background: `linear-gradient(150deg, ${T.bg}, ${T.goldBg})`, display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}>
                         <span style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 34, color: T.goldLine }}>{(s.name||"?")[0]}</span>
                       </div>}
            <div style={{ padding: 15, display: "flex", flexDirection: "column", flex: 1 }}>
              <div style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 18, fontWeight: 600, color: T.ink, marginBottom: 8, lineHeight: 1.15 }}>{s.name}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 11.5, color: T.soft, marginBottom: 10 }}>
                <span><b style={{ color: T.ink, fontWeight: 500 }}>{s.kind || "Gelato"}</b> · {eqShort(s.equipment || "tradicional")}</span>
                <span>{(s.school || "CucinaLi")} · {FAMILY_GROUP[s.family] || famLabel(s.family)}</span>
                <span style={{ fontFamily: "'DM Mono', monospace" }}>{s.servingTemp}°C · PAC {s.pac}</span>
              </div>
              {tags.length > 0 && <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 12 }}>{tags.slice(0, 3).map((t) => { const tc = tagColor(t); return <span key={t} style={{ fontSize: 9.5, background: tc.bg, color: tc.fg, padding: "2px 8px", borderRadius: 20, fontWeight: 600 }}>{t}</span>; })}</div>}
              <div style={{ display: "flex", gap: 6, marginTop: "auto" }}>
                <button onClick={() => onOpen(s)} style={{ flex: 1, background: T.gold, color: "#fff", border: "none", borderRadius: 9, padding: "9px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>Abrir</button>
                <button onClick={() => onDelete(s)} style={{ background: "#fff", color: T.soft, border: `1px solid ${T.line}`, borderRadius: 9, padding: "9px 11px", fontSize: 12.5, cursor: "pointer" }}>×</button>
              </div>
            </div>
          </div>
        );})}
      </div>
      {filtered.length > 60 && <div style={{ fontSize: 12, color: T.soft, textAlign: "center", marginTop: 16 }}>Mostrando as primeiras 60 de {filtered.length}. Refine os filtros ou use a busca para encontrar uma receita específica.</div>}
    </div>
  );
}
function FilterGroup({ label, children }) {
  return <div style={{ display: "flex", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}><div style={{ fontSize: 10, letterSpacing: 1, color: T.gold, fontWeight: 700, textTransform: "uppercase", minWidth: 100, paddingTop: 6 }}>{label}</div><div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", flex: 1 }}>{children}</div></div>;
}

// ---- Painel de monitoramento (as 11 linhas da imagem) ----
// gera dicas explicativas de equilíbrio baseadas no método Corvitto
function buildTips(monitor, pacNow, pacTarget, servingTemp) {
  const tips = [];
  const by = (k) => monitor.find((m) => m.key === k);
  const pac = by("pac"), pod = by("pod"), sugars = by("sugars"), fat = by("fat"), solids = by("solids"), msnf = by("msnf"), other = by("other");
  const diff = Math.round(pacNow - pacTarget);
  // PAC — o coração do método
  if (diff > 14) {
    tips.push({ t: "PAC alto: vai ficar mole demais", b: `Para servir a ${servingTemp}°C o alvo é ${pacTarget}, mas você está em ${pacNow}. Como a dextrose e o açúcar invertido têm PAC ~190 (quase o dobro da sacarose, que é 100), troque parte deles por sacarose: baixa o PAC sem perder estrutura. Reduzir ~${Math.round(diff/0.9)}g de dextrose aproxima do alvo.` });
  } else if (diff < -14) {
    tips.push({ t: "PAC baixo: vai endurecer na vitrine", b: `Faltam ${-diff} pontos para o alvo de ${pacTarget}. Troque parte da sacarose (PAC 100) por dextrose (PAC 190) ou açúcar invertido — sobem o anticongelamento. Um blend clássico do Corvitto é dextrose + invertido para empurrar o PAC mantendo o doce equilibrado.` });
  }
  // POD — doçura
  if (pod && pod.status === "above") {
    tips.push({ t: "Doce demais (POD alto)", b: "O paladar vai sentir açucarado. Troque parte do açúcar invertido ou frutose (muito doces, POD 130–170) por dextrose (POD só 70): mantém o anticongelamento mas reduz a doçura percebida." });
  } else if (pod && pod.status === "below") {
    tips.push({ t: "Pouco doce (POD baixo)", b: "Aumente um pouco a sacarose ou adicione açúcar invertido (POD 130) para realçar o sabor sem disparar o PAC." });
  }
  // sólidos / textura
  if (solids && solids.status === "below") {
    tips.push({ t: "Sólidos totais baixos: textura aguada e gelo", b: "Há água livre demais — risco de cristais de gelo. Adicione sólidos sem adoçar: leite em pó magro (sobe SLNG) ou fibra como inulina (sobe os sólidos e dá cremosidade sem açúcar e sem sabor)." });
  } else if (solids && solids.status === "above") {
    tips.push({ t: "Sólidos totais altos: risco de textura arenosa", b: "Acima de ~42% o gelato fica 'pesado'/arenoso por falta de água. Reduza leite em pó ou açúcares, ou aumente um pouco a parte líquida (leite)." });
  }
  if (fat && fat.status === "below") tips.push({ t: "Gordura baixa", b: "Para mais cremosidade e corpo, aumente o creme ou acrescente gema (no caso de gelato de gema). A gordura carrega aroma e dá a sensação aveludada." });
  if (fat && fat.status === "above") tips.push({ t: "Gordura alta", b: "Pode pesar no paladar e 'engordurar'. Troque parte do creme por leite para reduzir, mantendo os sólidos com leite em pó." });
  if (other && other.status === "above") tips.push({ t: "Outros sólidos altos", b: "Ingredientes como cacau, pasta de frutos secos e fibras somam sólidos rápido. Compense reduzindo um pouco os açúcares ou o leite em pó para não estourar os sólidos totais." });
  return tips;
}

function MonitorPanel({ monitor, servingTemp, pacTarget, pacNow, suggestions, onApplySwap }) {
  const pacSwap = (suggestions || []).find((s) => s.swap)?.swap;
  const tips = buildTips(monitor, pacNow, pacTarget, servingTemp);
  const pacDiff = Math.round(pacNow - pacTarget);
  return (
    <div style={{ background: "#fff", border: `1px solid ${T.line}`, borderRadius: 16, overflow: "hidden", boxShadow: "0 1px 3px rgba(60,58,54,.04)" }}>
      <div style={{ padding: "13px 18px", borderBottom: `1px solid ${T.line}`, display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
        <span style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 16, fontWeight: 600, color: T.ink }}>Parâmetros de controle</span>
        <span style={{ fontSize: 12, color: T.soft }}>alvos para servir a <b style={{ color: T.ink, fontFamily: "'DM Mono', monospace" }}>{servingTemp}°C</b></span>
      </div>
      {/* destaque do PAC: o que a temperatura exige vs o que a receita tem */}
      <div style={{ padding: "14px 16px", background: MONCOLOR[Math.abs(pacDiff) <= 14 ? "in" : "above"].bg, borderLeft: `4px solid ${MONCOLOR[Math.abs(pacDiff) <= 14 ? "in" : "above"].fill}` }}>
        <div style={{ fontSize: 11.5, color: T.soft, marginBottom: 8 }}>Para servir a <b style={{ color: T.ink }}>{servingTemp}°C</b></div>
        <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
          <div style={{ flex: 1, background: "rgba(255,255,255,.6)", borderRadius: 10, padding: "8px 12px" }}>
            <div style={{ fontSize: 9.5, letterSpacing: 0.5, textTransform: "uppercase", color: T.soft, fontWeight: 600 }}>Alvo</div>
            <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 20, fontWeight: 700, color: T.ink }}>{pacTarget}</div>
          </div>
          <div style={{ flex: 1, background: "rgba(255,255,255,.6)", borderRadius: 10, padding: "8px 12px" }}>
            <div style={{ fontSize: 9.5, letterSpacing: 0.5, textTransform: "uppercase", color: T.soft, fontWeight: 600 }}>Você está em</div>
            <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 20, fontWeight: 700, color: MONCOLOR[Math.abs(pacDiff) <= 14 ? "in" : "above"].fill }}>{pacNow}</div>
          </div>
        </div>
        <div style={{ fontSize: 13, fontWeight: 700, color: MONCOLOR[Math.abs(pacDiff) <= 14 ? "in" : "above"].fill, marginBottom: pacSwap && Math.abs(pacDiff) > 14 ? 12 : 0 }}>
          {Math.abs(pacDiff) <= 14 ? "✓ no ponto para essa temperatura" : pacDiff > 0 ? `↓ abaixe ${pacDiff} pts — mole demais para ${servingTemp}°C` : `↑ suba ${-pacDiff} pts — vai endurecer a ${servingTemp}°C`}
        </div>
        {pacSwap && Math.abs(pacDiff) > 14 && (
          <div style={{ background: "rgba(255,255,255,.55)", borderRadius: 10, padding: "11px 13px" }}>
            <div style={{ fontSize: 9.5, letterSpacing: 0.5, textTransform: "uppercase", color: T.soft, fontWeight: 600, marginBottom: 5 }}>Recomendação</div>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: T.ink, lineHeight: 1.5, marginBottom: 11 }}>
              {
                pacSwap.parts && pacSwap.remove ? <>Trocar <b style={{ color: "#c01f2f" }}>{pacSwap.grams}g de {pacSwap.remove}</b> por <b style={{ color: "#c01f2f" }}>{pacSwap.parts.map((p) => `${p.grams}g de ${swapLabel(p.add)}`).join(" + ")}</b></>
                : pacSwap.parts && pacSwap.removeBlend ? <>Trocar <b style={{ color: "#c01f2f" }}>{pacSwap.dexCut}g de dextrose + {pacSwap.invCut}g de invertido</b> por <b style={{ color: "#c01f2f" }}>{pacSwap.parts.map((p) => `${p.grams}g de ${swapLabel(p.add)}`).join(" + ")}</b></>
                : pacSwap.addOnly ? <>Adicionar <b style={{ color: "#c01f2f" }}>{pacSwap.grams}g de {swapLabel(pacSwap.add)}</b></>
                : <>Ajustar os açúcares</>
              }
            </div>
            <button onClick={() => onApplySwap(pacSwap)} style={{ width: "100%", background: T.gold, color: "#fff", border: "none", borderRadius: 9, padding: "11px", fontSize: 13.5, fontWeight: 700, cursor: "pointer", boxShadow: "0 2px 8px rgba(176,141,63,.3)" }}>Aplicar agora</button>
          </div>
        )}
      </div>
      <div style={{ fontSize: 10.5, color: T.soft, padding: "8px 18px 0", fontStyle: "italic" }}>↔ no celular, arraste a tabela para o lado para ver todas as colunas</div>
      <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch", position: "relative" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 520 }}>
        <thead><tr>
          {["Verificação", "Faixa ideal", "Atual", "Diferença", "OK?"].map((h, k) => (
            <th key={k} style={{ fontSize: 10, letterSpacing: 0.5, textTransform: "uppercase", color: T.soft, fontWeight: 600, padding: "9px 8px", textAlign: k === 0 ? "left" : "right", borderBottom: `1px solid ${T.line}`, whiteSpace: "nowrap" }}>{h}</th>
          ))}
        </tr></thead>
        <tbody>
          {monitor.map((m) => {
            const c = MONCOLOR[m.status];
            if (m.status === "na") {
              return (
                <tr key={m.key} style={{ borderBottom: `1px solid ${T.bg}`, opacity: 0.5 }}>
                  <td style={{ padding: "8px 8px", fontSize: 12.5, color: T.soft }}>{m.label}</td>
                  <td colSpan={3} style={{ padding: "8px 8px", fontSize: 11.5, textAlign: "right", color: T.soft, fontStyle: "italic" }}>— não se aplica a este tipo</td>
                  <td style={{ padding: "8px 8px", textAlign: "right" }}><span style={{ fontSize: 10.5, background: c.bg, color: c.fill, padding: "3px 10px", borderRadius: 20, fontWeight: 600 }}>—</span></td>
                </tr>
              );
            }
            // diferença até a borda mais próxima da faixa
            let diff = 0;
            if (m.val < m.min) diff = round(m.val - m.min, 1);
            else if (m.val > m.max) diff = round(m.val - m.max, 1);
            const diffTxt = diff === 0 ? "—" : (diff > 0 ? `+${diff}` : `${diff}`) + m.unit;
            const isPac = m.key === "pac";
            return (
              <tr key={m.key} style={{ borderBottom: `1px solid ${T.bg}`, background: m.status === "in" ? "transparent" : c.bg, borderLeft: `4px solid ${m.status === "in" ? "transparent" : c.fill}` }}>
                <td style={{ padding: "8px 8px", fontSize: 12.5, color: T.ink, fontWeight: m.status === "in" ? 400 : 600 }}>{m.label}<span style={{ color: T.soft, fontSize: 11, marginLeft: 6 }}>{m.note}</span></td>
                <td style={{ padding: "8px 8px", fontSize: 12, textAlign: "right", color: T.soft, fontFamily: "'DM Mono', monospace", whiteSpace: "nowrap" }}>{m.min}–{m.max}{m.unit}</td>
                <td style={{ padding: "8px 8px", fontSize: 13.5, textAlign: "right", color: c.fill, fontWeight: 700, fontFamily: "'DM Mono', monospace", whiteSpace: "nowrap" }}>{m.val}{m.unit}</td>
                <td style={{ padding: "8px 8px", fontSize: 12, textAlign: "right", color: diff === 0 ? T.soft : c.fill, fontWeight: diff === 0 ? 400 : 700, fontFamily: "'DM Mono', monospace" }}>{diffTxt}</td>
                <td style={{ padding: "8px 8px", textAlign: "right" }}>
                  <span style={{ fontSize: 10.5, background: c.fill, color: "#fff", padding: "3px 11px", borderRadius: 6, fontWeight: 700, letterSpacing: 0.5 }}>{c.label}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
      {tips.length > 0 && (
        <div style={{ borderTop: `1px solid ${T.line}`, padding: "14px 18px", background: T.sunBg }}>
          <div style={{ fontSize: 10.5, letterSpacing: 1, textTransform: "uppercase", color: T.gold, fontWeight: 600, marginBottom: 10 }}>✦ Dicas de equilíbrio (método Corvitto)</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {tips.map((tip, i) => (
              <div key={i}>
                <div style={{ fontSize: 13, fontWeight: 600, color: T.ink, marginBottom: 2 }}>{tip.t}</div>
                <div style={{ fontSize: 12.5, color: "#6b6358", lineHeight: 1.5 }}>{tip.b}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---- Curva de congelamento (tema claro) ----
function Curve({ pacPerKg, servingTemp }) {
  const { f } = freezingCurve(pacPerKg);
  const W = 440, H = 200, padL = 40, padB = 30, padT = 12, padR = 12;
  const x = (t) => padL + ((t - 0) / (-24 - 0)) * (W - padL - padR);
  const y = (fr) => padT + (1 - fr) * (H - padT - padB);
  const pts = []; for (let t = 0; t >= -24; t -= 0.5) pts.push(`${x(t)},${y(f(t))}`);
  const cur = f(servingTemp), cx = x(servingTemp), cy = y(cur);
  return (
    <div style={{ background: "#fff", border: `1px solid ${T.line}`, borderRadius: 16, padding: 16, boxShadow: "0 1px 3px rgba(60,58,54,.04)", height: "100%", boxSizing: "border-box" }}>
      <div style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 16, fontWeight: 600, color: T.ink, marginBottom: 2 }}>Curva de congelamento</div>
      <div style={{ fontSize: 12.5, color: T.soft, marginBottom: 10 }}>A {servingTemp}°C, cerca de <b style={{ color: T.gold }}>{Math.round(cur * 100)}%</b> da água está congelada.</div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%">
        {[0, 25, 50, 75, 100].map((p) => (<g key={p}><line x1={padL} y1={y(p / 100)} x2={W - padR} y2={y(p / 100)} stroke={T.line} strokeWidth="1" /><text x={padL - 6} y={y(p / 100) + 4} fill={T.soft} fontSize="10" textAnchor="end" fontFamily="'DM Mono', monospace">{p}%</text></g>))}
        {[0, -6, -11, -18, -24].map((t) => <text key={t} x={x(t)} y={H - padB + 16} fill={T.soft} fontSize="10" textAnchor="middle" fontFamily="'DM Mono', monospace">{t}°</text>)}
        <rect x={padL} y={y(0.80)} width={W - padL - padR} height={y(0.65) - y(0.80)} fill={T.goldBg} />
        <path d={"M" + pts.join(" L")} fill="none" stroke={T.gold} strokeWidth="2.5" strokeLinecap="round" />
        <line x1={cx} y1={padT} x2={cx} y2={H - padB} stroke={T.straw} strokeWidth="1" strokeDasharray="4 4" />
        <circle cx={cx} cy={cy} r="7" fill={T.straw} /><circle cx={cx} cy={cy} r="7" fill="none" stroke="#fff" strokeWidth="2.5" />
        <text x={cx} y={cy - 12} fill={T.straw} fontSize="11" textAnchor="middle" fontWeight="700" fontFamily="'DM Mono', monospace">{Math.round(cur * 100)}%</text>
      </svg>
    </div>
  );
}

const inp = { width: "100%", background: "#fff", border: `1px solid ${T.line}`, borderRadius: 9, color: T.ink, padding: "8px 10px", fontSize: 13, boxSizing: "border-box" };
const sel = { width: "100%", background: T.bg, border: `1px solid ${T.line}`, borderRadius: 9, color: T.ink, padding: "8px 10px", fontSize: 14, fontWeight: 600, boxSizing: "border-box", cursor: "pointer", fontFamily: "'DM Mono', monospace" };
function lossYield(i) { return (1 - (i.lossClean || 0) / 100) * (1 - (i.lossCook || 0) / 100) * (1 - (i.lossWaste || 0) / 100); }
function Field({ label, children }) { return <label style={{ display: "block", marginBottom: 8 }}><span style={{ display: "block", fontSize: 11, color: T.soft, marginBottom: 3 }}>{label}</span>{children}</label>; }

function AddModal({ db, onPick, onClose }) {
  const [q, setQ] = useState("");
  const filtered = db.filter((i) => i.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(60,58,54,.35)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "40px 20px", zIndex: 10, borderRadius: 18 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", border: `1px solid ${T.line}`, borderRadius: 16, width: "100%", maxWidth: 520, maxHeight: "80%", display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 20px 50px rgba(60,58,54,.2)" }}>
        <div style={{ padding: 14, borderBottom: `1px solid ${T.line}` }}><input autoFocus placeholder="Buscar ingrediente…" value={q} onChange={(e) => setQ(e.target.value)} style={inp} /></div>
        <div style={{ overflowY: "auto", padding: "4px 0" }}>
          {CATEGORIES.map((cat) => {
            const list = filtered.filter((i) => i.cat === cat.id); if (!list.length) return null;
            return (<div key={cat.id}>
              <div style={{ padding: "10px 16px 5px", fontSize: 10.5, letterSpacing: 1, textTransform: "uppercase", color: T.gold, fontWeight: 600 }}>{cat.label}</div>
              {list.map((i) => <button key={i.id} onClick={() => onPick(i.id)} style={{ display: "flex", justifyContent: "space-between", width: "100%", background: "none", border: "none", color: T.ink, padding: "9px 16px", fontSize: 13.5, cursor: "pointer", textAlign: "left" }} onMouseEnter={(e) => e.currentTarget.style.background = T.bg} onMouseLeave={(e) => e.currentTarget.style.background = "none"}><span>{i.name}{i.clean && <span style={{ marginLeft: 6, fontSize: 8.5, background: "#e9f3ee", color: "#1a7d54", padding: "1px 5px", borderRadius: 10, fontWeight: 700 }}>CLEAN</span>}</span><span style={{ color: T.soft, fontFamily: "'DM Mono', monospace", fontSize: 12 }}>R${i.costPerKg}</span></button>)}
            </div>);
          })}
        </div>
      </div>
    </div>
  );
}

function IngredientsTab({ db, setDb }) {
  const [editing, setEditing] = useState(null);
  const blank = { id: "", cat: "dairy", name: "", water: 0, fat: 0, msnf: 0, otherSolids: 0, sugars: {}, alcohol: 0, lossClean: 0, lossCook: 0, lossWaste: 0, costPerKg: 0 };
  const num = (v) => Number(v) || 0;
  const save = (d) => { setDb((p) => { const ex = p.find((x) => x.id === d.id); return ex ? p.map((x) => x.id === d.id ? d : x) : [...p, d]; }); setEditing(null); };
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <div style={{ fontSize: 13, color: T.soft }}>Composição, preço e perdas — o custo real recalcula sozinho.</div>
        <button onClick={() => setEditing({ ...blank, id: "new-" + Date.now(), _new: true })} style={{ background: T.gold, color: "#fff", border: "none", borderRadius: 10, padding: "9px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>+ Novo</button>
      </div>
      {CATEGORIES.map((cat) => {
        const list = db.filter((i) => i.cat === cat.id); if (!list.length) return null;
        return (<div key={cat.id} style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 10.5, letterSpacing: 1, textTransform: "uppercase", color: T.mint, fontWeight: 600, marginBottom: 6 }}>{cat.label}</div>
          <div style={{ background: "#fff", border: `1px solid ${T.line}`, borderRadius: 14, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr>{["Nome", "Água", "Gord.", "Açúc.", "Sól.", "Compra", "Perda", "Real", ""].map((h, k) => <th key={k} style={{ fontSize: 10, color: T.soft, fontWeight: 600, padding: "8px 9px", textAlign: k === 0 ? "left" : "right", textTransform: "uppercase", borderBottom: `1px solid ${T.line}` }}>{h}</th>)}</tr></thead>
              <tbody>{list.map((i) => {
                const y = lossYield(i), real = y > 0 ? i.costPerKg / y : i.costPerKg, lp = Math.round((1 - y) * 100);
                const sug = Object.values(i.sugars || {}).reduce((a, b) => a + b, 0);
                return (<tr key={i.id} style={{ borderBottom: `1px solid ${T.bg}` }}>
                  <td style={{ padding: "8px 9px", fontSize: 13, color: T.ink }}>{i.name}{i.clean && <span style={{ marginLeft: 6, fontSize: 9, background: "#e9f3ee", color: "#1a7d54", padding: "1px 6px", borderRadius: 10, fontWeight: 700, letterSpacing: 0.3 }}>CLEAN</span>}{i.intense && <span style={{ marginLeft: 4, fontSize: 9, background: T.goldBg, color: T.gold, padding: "1px 6px", borderRadius: 10, fontWeight: 700 }}>INTENSO</span>}</td>
                  <td style={{ padding: "8px 9px", fontSize: 12, textAlign: "right", color: T.soft, fontFamily: "'DM Mono', monospace" }}>{i.water}%</td>
                  <td style={{ padding: "8px 9px", fontSize: 12, textAlign: "right", color: T.soft, fontFamily: "'DM Mono', monospace" }}>{i.fat}%</td>
                  <td style={{ padding: "8px 9px", fontSize: 12, textAlign: "right", color: T.soft, fontFamily: "'DM Mono', monospace" }}>{sug ? sug + "%" : "—"}</td>
                  <td style={{ padding: "8px 9px", fontSize: 12, textAlign: "right", color: T.soft, fontFamily: "'DM Mono', monospace" }}>{Math.round(100 - i.water)}%</td>
                  <td style={{ padding: "8px 9px", fontSize: 12.5, textAlign: "right", color: T.soft, fontFamily: "'DM Mono', monospace" }}>{i.costPerKg.toFixed(2)}</td>
                  <td style={{ padding: "8px 9px", fontSize: 12.5, textAlign: "right", color: lp > 0 ? T.sun : T.line, fontFamily: "'DM Mono', monospace" }}>{lp}%</td>
                  <td style={{ padding: "8px 9px", fontSize: 13, textAlign: "right", color: lp > 0 ? T.straw : T.ink, fontWeight: 500, fontFamily: "'DM Mono', monospace" }}>{real.toFixed(2)}</td>
                  <td style={{ textAlign: "center" }}><button onClick={() => setEditing({ ...i })} style={{ background: "none", border: "none", color: T.blue, cursor: "pointer", fontSize: 12.5 }}>editar</button></td>
                </tr>);
              })}</tbody>
            </table>
          </div>
        </div>);
      })}
      {editing && (
        <div onClick={() => setEditing(null)} style={{ position: "absolute", inset: 0, background: "rgba(60,58,54,.35)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "30px 20px", zIndex: 20, borderRadius: 18, overflowY: "auto" }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, width: "100%", maxWidth: 560, padding: 22, boxShadow: "0 20px 50px rgba(60,58,54,.2)" }}>
            <h3 style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 20, fontWeight: 600, margin: "0 0 16px", color: T.ink }}>{editing._new ? "Novo ingrediente" : "Editar ingrediente"}</h3>
            <Field label="Nome"><input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} style={inp} /></Field>
            <Field label="Categoria"><select value={editing.cat} onChange={(e) => setEditing({ ...editing, cat: e.target.value })} style={inp}>{CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></Field>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
              <Field label="Água %"><input type="number" value={editing.water} onChange={(e) => setEditing({ ...editing, water: num(e.target.value) })} style={inp} /></Field>
              <Field label="Gordura %"><input type="number" value={editing.fat} onChange={(e) => setEditing({ ...editing, fat: num(e.target.value) })} style={inp} /></Field>
              <Field label="SLNG %"><input type="number" value={editing.msnf} onChange={(e) => setEditing({ ...editing, msnf: num(e.target.value) })} style={inp} /></Field>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
              <Field label="Sacarose %"><input type="number" value={editing.sugars.sucrose || 0} onChange={(e) => setEditing({ ...editing, sugars: { ...editing.sugars, sucrose: num(e.target.value) } })} style={inp} /></Field>
              <Field label="Dextrose %"><input type="number" value={editing.sugars.dextrose || 0} onChange={(e) => setEditing({ ...editing, sugars: { ...editing.sugars, dextrose: num(e.target.value) } })} style={inp} /></Field>
              <Field label="Outros sól. %"><input type="number" value={editing.otherSolids} onChange={(e) => setEditing({ ...editing, otherSolids: num(e.target.value) })} style={inp} /></Field>
            </div>
            <div style={{ fontSize: 10.5, letterSpacing: 1, color: T.sun, fontWeight: 600, margin: "12px 0 6px", textTransform: "uppercase" }}>Preço e perdas</div>
            <Field label="Preço de compra R$/kg"><input type="number" value={editing.costPerKg} onChange={(e) => setEditing({ ...editing, costPerKg: num(e.target.value) })} style={inp} /></Field>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
              <Field label="Perda limpeza %"><input type="number" value={editing.lossClean} onChange={(e) => setEditing({ ...editing, lossClean: num(e.target.value) })} style={inp} /></Field>
              <Field label="Perda cocção %"><input type="number" value={editing.lossCook} onChange={(e) => setEditing({ ...editing, lossCook: num(e.target.value) })} style={inp} /></Field>
              <Field label="Perda descarte %"><input type="number" value={editing.lossWaste} onChange={(e) => setEditing({ ...editing, lossWaste: num(e.target.value) })} style={inp} /></Field>
            </div>
            <div style={{ background: T.mintBg, borderRadius: 10, padding: "10px 12px", margin: "10px 0 16px", fontSize: 13, color: T.ink }}>Rendimento útil: <b style={{ fontFamily: "'DM Mono', monospace" }}>{Math.round(lossYield(editing) * 100)}%</b> · Custo real: <b style={{ fontFamily: "'DM Mono', monospace", color: T.straw }}>R${(lossYield(editing) > 0 ? editing.costPerKg / lossYield(editing) : editing.costPerKg).toFixed(2)}/kg</b></div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setEditing(null)} style={{ background: "#fff", color: T.soft, border: `1px solid ${T.line}`, borderRadius: 10, padding: "9px 16px", fontSize: 13, cursor: "pointer" }}>Cancelar</button>
              <button onClick={() => save(editing)} style={{ background: T.gold, color: "#fff", border: "none", borderRadius: 10, padding: "9px 18px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Salvar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function GelatoLab({ session }) {
  const userId = session?.user?.id;
  const [tab, setTab] = useState("formula");
  const [db, setDb] = useState(INGREDIENTS);
  const [servingTemp, setServingTemp] = useState(-11);
  const [family, setFamily] = useState("cream");
  const [kind, setKind] = useState("Gelato");
  const [targetWeight, setTargetWeight] = useState(1000);
  const [recipeName, setRecipeName] = useState("Nova receita");
  const [notes, setNotes] = useState("");
  const [prep, setPrep] = useState("");
  const [photo, setPhoto] = useState(null);
  const [currentDbId, setCurrentDbId] = useState(null); // id da receita aberta no banco (se houver)
  const [salvando, setSalvando] = useState(false);
  const [school, setSchool] = useState("Autoral");
  const [chef, setChef] = useState("");
  const [equipment, setEquipment] = useState("tradicional");
  const [modal, setModal] = useState(false);
  const [method, setMethod] = useState("classic"); // classic | clean | reduce
  const [customFams, setCustomFams] = useState([]); // famílias criadas pelo usuário
  const [famVersion, setFamVersion] = useState(0); // força re-render ao editar faixas
  const allFamilies = [...FAMILIES, ...customFams];
  const createFamily = (name, baseId) => {
    const id = "custom-" + Date.now();
    FAMILY_RANGES[id] = { ...FAMILY_RANGES[baseId] };
    FAMILY_PARAMS[id] = JSON.parse(JSON.stringify(FAMILY_PARAMS[baseId]));
    FAMILY_PAC_OFFSET[id] = FAMILY_PAC_OFFSET[baseId] || 0;
    setCustomFams((p) => [...p, { id, label: name, author: "Autoral", locked: false, baseLabel: allFamilies.find((f) => f.id === baseId)?.label }]);
    return id;
  };
  const duplicateFamily = (srcId) => {
    const src = allFamilies.find((f) => f.id === srcId);
    const id = createFamily(`${src.label} (cópia)`, srcId);
    return id;
  };
  const deleteFamily = (id) => { setCustomFams((p) => p.filter((f) => f.id !== id)); };
  const setFamParam = (famId, key, idx, value) => {
    const P = FAMILY_PARAMS[famId]; if (!P || !P[key]) return;
    P[key][idx] = value === "" ? 0 : Number(value);
    setFamVersion((v) => v + 1);
  };
  const renameFamily = (id, label) => { setCustomFams((p) => p.map((f) => f.id === id ? { ...f, label } : f)); };
  const ingFromDb = (id) => db.find((x) => x.id === id);
  const famLabel = (fid) => [...FAMILIES, ...customFams].find((f) => f.id === fid)?.label ?? fid;
  const [items, setItems] = useState(() => [{ id: "milk-whole", grams: 567 }, { id: "cream-35", grams: 172 }, { id: "smp", grams: 42 }, { id: "dextrose", grams: 137 }, { id: "inverted", grams: 26 }, { id: "sucrose", grams: 50 }, { id: "stabilizer", grams: 6 }].map((x) => ({ ingredient: INGREDIENTS.find((i) => i.id === x.id), grams: x.grams })));
  const [saved, setSaved] = useState([]);
  const [carregandoReceitas, setCarregandoReceitas] = useState(true);
  // carrega as receitas do usuário ao abrir
  useEffect(() => {
    let vivo = true;
    listarReceitas()
      .then((linhas) => { if (vivo) setSaved(linhas.map(linhaParaApp)); })
      .catch((e) => console.error("erro ao carregar receitas:", e))
      .finally(() => { if (vivo) setCarregandoReceitas(false); });
    return () => { vivo = false; };
  }, []);

  const liveItems = items.map((it) => ({ ingredient: ingFromDb(it.ingredient.id) || it.ingredient, grams: it.grams }));
  const r = useMemo(() => compute(liveItems, { servingTemp, family }, { method }), [items, servingTemp, family, db, method]);
  const scale = r.totalGrams > 0 ? targetWeight / r.totalGrams : 1;
  // recomendação de gramas dirigida pela TEMPERATURA: aplica o swap de PAC virtualmente
  // e devolve, por ingrediente, o novo peso sugerido (para mostrar na ficha como "→ X")
  const pacSwap = (r.suggestions || []).find((s) => s.swap)?.swap || null;
  const recGrams = (() => {
    if (!pacSwap) return null;
    const map = { sacarose: "sucrose", dextrose: "dextrose", inverted: "inverted" };
    const rec = {}; const additions = [];
    // base: gramas atuais por id
    liveItems.forEach((it, i) => { rec[i] = Number(it.grams) || 0; });
    // remoções (trocar parte da sacarose, ou reverter blend)
    if (pacSwap.remove) {
      const remId = map[pacSwap.remove];
      liveItems.forEach((it, i) => { if (it.ingredient.id === remId) rec[i] = Math.max(0, rec[i] - pacSwap.grams); });
    }
    if (pacSwap.removeBlend) {
      let cutDex = pacSwap.dexCut || 0, cutInv = pacSwap.invCut || 0;
      liveItems.forEach((it, i) => { if (it.ingredient.id === "dextrose" && cutDex > 0) { const t = Math.min(rec[i], cutDex); rec[i] -= t; cutDex -= t; } });
      liveItems.forEach((it, i) => { if (it.ingredient.id === "inverted" && cutInv > 0) { const t = Math.min(rec[i], cutInv); rec[i] -= t; cutInv -= t; } });
    }
    // adições (partes do blend ou açúcar único)
    const parts = pacSwap.parts || (pacSwap.add ? [{ add: pacSwap.add, grams: pacSwap.grams }] : []);
    parts.forEach((p) => {
      const addId = map[p.add];
      const idx = liveItems.findIndex((it) => it.ingredient.id === addId);
      if (idx >= 0) rec[idx] = (rec[idx] || 0) + p.grams;
      else additions.push({ id: addId, name: p.add, grams: p.grams });
    });
    rec._additions = additions;
    return rec;
  })();
  const setGrams = (idx, v) => setItems((p) => p.map((it, i) => i === idx ? { ...it, grams: v } : it));
  const removeItem = (idx) => setItems((p) => p.filter((_, i) => i !== idx));
  const pickItem = (id) => { setItems((p) => [...p, { ingredient: ingFromDb(id), grams: 0 }]); setModal(false); };
  const applySwap = (swap) => {
    if (!swap) return;
    const map = { sacarose: "sucrose", dextrose: "dextrose", inverted: "inverted", erythritol: "erythritol", stevia: "stevia", monkfruit: "monkfruit", allulose: "allulose" };
    setItems((p) => {
      let n = p.map((it) => ({ ...it }));
      const addG = (id, grams) => {
        const ex = n.find((it) => it.ingredient.id === id);
        if (ex) ex.grams = (Number(ex.grams) || 0) + grams;
        else n.push({ ingredient: ingFromDb(id), grams });
      };
      const subG = (id, grams) => {
        let toRemove = grams;
        n.forEach((it) => { if (it.ingredient.id === id && toRemove > 0) { const take = Math.min(Number(it.grams) || 0, toRemove); it.grams = (Number(it.grams) || 0) - take; toRemove -= take; } });
      };
      if (swap.reduce) {
        subG("sucrose", swap.removeSucrose);
        addG("erythritol", swap.addEryth);
        addG(map[swap.addIntense] || "stevia", Math.max(1, swap.intenseGrams));
        return n.filter((it) => (Number(it.grams) || 0) > 0 || it.ingredient.id === "water");
      }
      if (swap.remove) subG(map[swap.remove], swap.grams);
      if (swap.removeBlend) { subG("dextrose", swap.dexCut || 0); subG("inverted", swap.invCut || 0); }
      const parts = swap.parts || (swap.add ? [{ add: swap.add, grams: swap.grams }] : []);
      parts.forEach((pt) => addG(map[pt.add] || pt.add, pt.grams));
      return n.filter((it) => (Number(it.grams) || 0) > 0 || it.ingredient.id === "water");
    });
  };
  const onPhoto = (e) => { const f = e.target.files?.[0]; if (!f) return; const rd = new FileReader(); rd.onload = () => setPhoto(rd.result); rd.readAsDataURL(f); };
  const receitaAtual = (dbId) => ({ dbId, name: recipeName, kind, servingTemp, family, items: items.map((it) => ({ id: it.ingredient.id, grams: it.grams })), targetWeight, pac: r.pacPerKg, notes, prep, photo, school, chef, equipment });
  const recarregar = async () => { try { const linhas = await listarReceitas(); setSaved(linhas.map(linhaParaApp)); } catch (e) { console.error(e); } };
  const saveRecipe = async () => {
    setSalvando(true);
    try {
      const salva = await salvarReceita(receitaAtual(currentDbId), userId);
      setCurrentDbId(salva.id);
      await recarregar();
    } catch (e) { alert("Não consegui salvar: " + e.message); }
    finally { setSalvando(false); }
  };
  const saveAsNew = async () => {
    setSalvando(true);
    const nm = `${recipeName} (cópia)`; setRecipeName(nm);
    try {
      const salva = await salvarReceita({ ...receitaAtual(null), name: nm }, userId);
      setCurrentDbId(salva.id);
      await recarregar();
    } catch (e) { alert("Não consegui salvar: " + e.message); }
    finally { setSalvando(false); }
  };
  const openRecipe = (s) => { setCurrentDbId(s.dbId || null); setRecipeName(s.name); setKind(s.kind || "Gelato"); setServingTemp(s.servingTemp); setFamily(s.family); setTargetWeight(s.targetWeight); setItems(s.items.map((x) => ({ ingredient: ingFromDb(x.id), grams: x.grams }))); setNotes(s.notes || ""); setPrep(s.prep || ""); setPhoto(s.photo || null); setSchool(s.school || "Autoral"); setChef(s.chef || ""); setEquipment(s.equipment || "tradicional"); if (s.equipment && EQUIPMENT.find(e=>e.id===s.equipment)) setServingTemp(s.servingTemp); setTab("formula"); };
  const newRecipe = () => { setCurrentDbId(null); setRecipeName("Nova receita"); setKind("Gelato"); setItems([]); setNotes(""); setPrep(""); setPhoto(null); setSchool("Autoral"); setChef(""); setEquipment("tradicional"); setTab("formula"); };
  const deleteRecipe = async (s) => { try { if (s.dbId) await apagarReceita(s.dbId); await recarregar(); } catch (e) { alert("Não consegui apagar: " + e.message); } };
  const sair = async () => { await supabase.auth.signOut(); };
  const exportPDF = () => {
    const rowsHtml = liveItems.map((it, i) => { const d = r.rows[i]; return `<tr><td>${it.ingredient.name}</td><td class=n>${fmt2(d.g * scale)}</td><td class=n>${fmt2(d.fat * scale)}</td><td class=n>${fmt2(d.pod * scale)}</td><td class=n>${fmt2(d.msnf * scale)}</td><td class=n>${fmt2(d.st * scale)}</td><td class=n>${fmt2(d.pac * scale)}</td></tr>`; }).join("");
    const monHtml = r.monitor.filter((m) => m.status !== "na").map((m) => `<tr><td>${m.label}</td><td class=n>${m.min}${m.unit}</td><td class=n>${m.max}${m.unit}</td><td class=n><b>${m.val}${m.unit}</b></td><td class=n>${m.status === "in" ? "OK" : m.status === "below" ? "baixo" : "alto"}</td></tr>`).join("");
    const html = '<!doctype html><meta charset=utf-8><title>' + recipeName + '</title><style>body{font-family:Georgia,serif;color:#3d3a36;max-width:720px;margin:30px auto;padding:0 24px}h1{font-size:25px;margin:0 0 2px}.s{color:#7cc9b5;font-size:12px;letter-spacing:2px;text-transform:uppercase}.m{display:flex;gap:20px;font-size:13px;color:#666;margin:8px 0 18px;border-bottom:2px solid #eee;padding-bottom:12px}table{width:100%;border-collapse:collapse;margin-bottom:18px}th{font-size:10px;text-transform:uppercase;color:#7cc9b5;text-align:right;padding:6px 8px;border-bottom:1.5px solid #ddd}th:first-child{text-align:left}td{padding:5px 8px;font-size:13px;border-bottom:1px solid #f3f3f3}td.n{text-align:right}.hint{background:#fbf2dd;border-radius:8px;padding:10px 14px;font-size:12px;color:#8a6d1e;margin-bottom:16px}@media print{.hint{display:none}}</style>' +
      '<div class=hint>Para salvar como PDF: Ctrl+P (ou Cmd+P) e escolha "Salvar como PDF".</div><div class=s>GelatoLab</div><h1>' + recipeName + '</h1>' + (chef ? '<div style="font-style:italic;color:#7a7264;margin:-2px 0 6px;font-family:Georgia,serif">por ' + chef + (school && school !== "Autoral" ? ' · linha ' + school : '') + '</div>' : (school && school !== "Autoral" ? '<div style="font-style:italic;color:#7a7264;margin:-2px 0 6px">linha ' + school + '</div>' : '')) + '<div class=m><span>' + kind + '</span><span>' + famLabel(family) + '</span><span>' + servingTemp + '°C</span><span>' + (targetWeight >= 1000 ? targetWeight / 1000 + "kg" : targetWeight + "g") + '</span></div>' +
      '<table><thead><tr><th>Ingrediente</th><th>Peso</th><th>Gord.</th><th>POD</th><th>SLNG</th><th>Sólidos</th><th>PAC</th></tr></thead><tbody>' + rowsHtml + '</tbody></table>' +
      (photo ? '<img src="' + photo + '" style="width:100%;max-height:320px;object-fit:cover;border-radius:10px;margin-bottom:16px">' : '') +
      (notes ? '<h3 style="font-size:15px">Observações</h3><p style="font-size:13px;line-height:1.6;white-space:pre-wrap">' + notes.replace(/</g, "&lt;") + '</p>' : '') +
      (prep ? '<h3 style="font-size:15px">Modo de preparo</h3><p style="font-size:13px;line-height:1.7;white-space:pre-wrap">' + prep.replace(/</g, "&lt;") + '</p>' : '') +
      '<h3 style="font-size:15px">Parâmetros de controle</h3><table><thead><tr><th>Verificação</th><th>Mín</th><th>Máx</th><th>Atual</th><th>OK?</th></tr></thead><tbody>' + monHtml + '</tbody></table>';
    const blob = new Blob([html], { type: "text/html;charset=utf-8" }); const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `ficha-${recipeName.replace(/[^\w]+/g, "-").toLowerCase()}.html`; document.body.appendChild(a); a.click(); document.body.removeChild(a); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const tabBtn = (id, label) => <button onClick={() => setTab(id)} style={{ background: "none", color: tab === id ? T.ink : T.soft, border: "none", borderBottom: tab === id ? `2px solid ${T.gold}` : "2px solid transparent", padding: "10px 16px", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>{label}</button>;
  const cellNum = { fontFamily: "'DM Mono', monospace", fontSize: 12.5, textAlign: "right", padding: "5px 9px", color: T.ink };
  const th = { fontSize: 10, letterSpacing: 0.5, textTransform: "uppercase", color: T.soft, fontWeight: 600, padding: "7px 9px", textAlign: "right", whiteSpace: "nowrap" };

  return (
    <div style={{ position: "relative", background: T.bg, color: T.ink, fontFamily: "'Inter', system-ui, sans-serif", minHeight: "100%", padding: 24, borderRadius: 18 }}>
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=DM+Mono:wght@400;500&family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&display=swap" />
      {modal && <AddModal db={db} onPick={pickItem} onClose={() => setModal(false)} />}

      <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 4 }}>
        <div style={{ width: 32, height: 32, borderRadius: "50% 50% 50% 5px", background: `linear-gradient(135deg, ${T.goldSoft}, ${T.gold})`, boxShadow: "0 2px 12px rgba(176,141,63,.35)" }} />
        <div>
          <div style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 22, fontWeight: 700, color: T.ink, letterSpacing: 0.3, lineHeight: 1 }}>Gelato<span style={{ color: T.gold }}>Lab</span></div>
          <div style={{ fontSize: 9.5, letterSpacing: 2.5, textTransform: "uppercase", color: T.goldSoft, fontWeight: 600, marginTop: 2 }}>Balanceamento de autor</div>
        </div>
      </div>
      <div style={{ height: 2, background: `linear-gradient(90deg, ${T.gold}, ${T.goldLine} 40%, transparent)`, marginBottom: 14, borderRadius: 2 }} />
      <div style={{ display: "flex", gap: 2, borderBottom: `1px solid ${T.line}`, marginBottom: 20, alignItems: "center" }}>
        {tabBtn("formula", "Formulação")}{tabBtn("ingredients", "Ingredientes")}{tabBtn("families", "Famílias")}{tabBtn("library", `Receitas (${saved.length})`)}
        <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12 }}>
          {salvando && <span style={{ fontSize: 12, color: T.gold }}>salvando…</span>}
          <span onClick={sair} style={{ fontSize: 12.5, color: T.soft, cursor: "pointer" }}>sair</span>
        </span>
      </div>

      {tab === "library" && <Library saved={saved} onOpen={openRecipe} onDelete={(s) => deleteRecipe(s)} famLabel={famLabel} />}
      {tab === "ingredients" && <IngredientsTab db={db} setDb={setDb} />}
      {tab === "families" && <FamiliesTab fams={allFamilies} version={famVersion} onCreate={createFamily} onDuplicate={duplicateFamily} onDelete={deleteFamily} onSetParam={setFamParam} onRename={renameFamily} onUse={(id) => { setFamily(id); setTab("formula"); }} />}

      {tab === "formula" && (<>
        <div style={{ display: "flex", gap: 0, marginBottom: 18, background: "#fff", border: `1px solid ${T.line}`, borderRadius: 20, overflow: "hidden", boxShadow: "0 2px 14px rgba(60,58,54,.06)", flexWrap: "wrap" }}>
          <label style={{ cursor: "pointer", flexShrink: 0, position: "relative", width: 200, minWidth: 160, flexGrow: 1, maxWidth: 240 }}>
            <input type="file" accept="image/*" onChange={onPhoto} style={{ display: "none" }} />
            {photo ? (
              <>
                <img src={photo} alt={recipeName} style={{ width: "100%", height: "100%", minHeight: 190, objectFit: "cover", display: "block" }} />
                <span style={{ position: "absolute", bottom: 10, left: 10, background: "rgba(43,38,32,.78)", color: "#fff", fontSize: 10.5, padding: "4px 10px", borderRadius: 20, fontWeight: 500, letterSpacing: 0.3 }}>trocar foto</span>
              </>
            ) : (
              <div style={{ width: "100%", height: "100%", minHeight: 190, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, color: T.goldSoft, background: `linear-gradient(150deg, ${T.bg}, ${T.goldBg})` }}>
                <div style={{ width: 46, height: 46, borderRadius: "50%", border: `1.5px solid ${T.goldLine}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26, color: T.gold }}>+</div>
                <span style={{ fontSize: 12, letterSpacing: 0.3, fontWeight: 500 }}>foto do gelato</span>
              </div>
            )}
          </label>
          <div style={{ flex: 1, minWidth: 280, padding: "18px 22px", display: "flex", flexDirection: "column", justifyContent: "space-between", gap: 14 }}>
            <div>
              <div style={{ fontSize: 10.5, letterSpacing: 1.5, textTransform: "uppercase", color: T.goldSoft, fontWeight: 700, marginBottom: 5 }}>{kind} · {famLabel(family)}{school && school !== "Autoral" ? ` · ${school}` : ""}</div>
              <input value={recipeName} onChange={(e) => setRecipeName(e.target.value)} placeholder="Nome da receita" style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 30, fontWeight: 600, background: "none", border: "none", color: T.ink, padding: 0, outline: "none", width: "100%", lineHeight: 1.05 }} />
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>
                <span style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 13.5, fontStyle: "italic", color: T.soft }}>por</span>
                <input value={chef} onChange={(e) => setChef(e.target.value)} placeholder="assinatura do chef" style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 13.5, fontStyle: "italic", background: "none", border: "none", borderBottom: `1px solid ${T.line}`, color: T.ink, padding: "1px 2px", outline: "none", width: 200 }} />
              </div>
              <div style={{ display: "flex", gap: 18, marginTop: 12, flexWrap: "wrap" }}>
                {[["Serve a", `${r.impliedServingTemp}°C`], ["PAC", r.pacPerKg], ["POD", r.podPerKg], ["Sólidos", `${r.stPct}%`]].map(([k, v], i) => (
                  <div key={i}>
                    <div style={{ fontSize: 9.5, letterSpacing: 0.5, textTransform: "uppercase", color: T.soft, fontWeight: 600 }}>{k}</div>
                    <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 16, fontWeight: 500, color: T.ink, marginTop: 1 }}>{v}</div>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ display: "flex", gap: 7, flexWrap: "wrap", alignItems: "center" }}>
              <button onClick={saveRecipe} style={{ background: T.gold, color: "#fff", border: "none", borderRadius: 10, padding: "9px 18px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Salvar</button>
              <button onClick={saveAsNew} style={{ background: T.goldBg, color: T.gold, border: `1px solid ${T.goldLine}`, borderRadius: 10, padding: "9px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Salvar como nova</button>
              <button onClick={exportPDF} style={{ background: "#fff", color: T.ink, border: `1px solid ${T.line}`, borderRadius: 10, padding: "9px 14px", fontSize: 13, cursor: "pointer" }}>Baixar ficha</button>
              <button onClick={newRecipe} style={{ background: "none", color: T.soft, border: "none", padding: "9px 8px", fontSize: 12.5, cursor: "pointer", marginLeft: "auto" }}>Nova do zero</button>
            </div>
          </div>
        </div>

        <div style={{ background: "#fff", borderRadius: 14, padding: "12px 16px", border: `1px solid ${T.line}`, marginBottom: 10, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <span style={{ fontSize: 10, letterSpacing: 1, color: T.gold, fontWeight: 700 }}>EQUIPAMENTO</span>
          <select value={equipment} onChange={(e) => { const id = e.target.value; setEquipment(id); const eq = EQUIPMENT.find((x) => x.id === id); if (eq) setServingTemp(eq.temp); }} style={{ ...sel, width: "auto", minWidth: 240, padding: "7px 12px", fontSize: 13 }}>
            {EQUIPMENT.map((eq) => <option key={eq.id} value={eq.id}>{eq.label}</option>)}
          </select>
          <span style={{ fontSize: 11.5, color: T.soft, flex: 1, minWidth: 200 }}>{EQUIPMENT.find((x) => x.id === equipment)?.note}</span>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginBottom: 16 }}>
          <div style={{ background: "#fff", borderRadius: 14, padding: "11px 13px", border: `1px solid ${T.line}` }}>
            <div style={{ fontSize: 10, letterSpacing: 1, color: T.gold, marginBottom: 6, fontWeight: 700 }}>1 · TEMPERATURA</div>
            <select value={servingTemp} onChange={(e) => setServingTemp(Number(e.target.value))} style={sel}>{TEMPS.map((t) => <option key={t} value={t}>{t} °C</option>)}</select>
          </div>
          <div style={{ background: "#fff", borderRadius: 14, padding: "11px 13px", border: `1px solid ${T.line}` }}>
            <div style={{ fontSize: 10, letterSpacing: 1, color: T.gold, marginBottom: 6, fontWeight: 700 }}>2 · PESO FINAL</div>
            <select value={targetWeight} onChange={(e) => setTargetWeight(Number(e.target.value))} style={sel}>{WEIGHTS.map((w) => <option key={w} value={w}>{w >= 1000 ? `${w / 1000} kg` : `${w} g`}</option>)}</select>
          </div>
          <div style={{ background: "#fff", borderRadius: 14, padding: "11px 13px", border: `1px solid ${T.line}` }}>
            <div style={{ fontSize: 10, letterSpacing: 1, color: T.gold, marginBottom: 6, fontWeight: 700 }}>3 · PREPARO</div>
            <select value={kind} onChange={(e) => setKind(e.target.value)} style={sel}>{KINDS.map((k) => <option key={k} value={k}>{k}</option>)}</select>
          </div>
          <div style={{ background: "#fff", borderRadius: 14, padding: "11px 13px", border: `1px solid ${T.line}` }}>
            <div style={{ fontSize: 10, letterSpacing: 1, color: T.gold, marginBottom: 6, fontWeight: 700 }}>FAMÍLIA</div>
            <select value={family} onChange={(e) => setFamily(e.target.value)} style={sel}>{allFamilies.map((f) => <option key={f.id} value={f.id}>{f.label}{f.locked ? "" : " ✎"}</option>)}</select>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 14, marginBottom: 16, alignItems: "stretch" }}>
          <Curve pacPerKg={r.pacPerKg} servingTemp={servingTemp} />
          <div style={{ background: "#fff", border: `1px solid ${T.line}`, borderRadius: 16, padding: 16, boxShadow: "0 1px 3px rgba(60,58,54,.04)", height: "100%", boxSizing: "border-box" }}>
            <div style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 16, fontWeight: 600, marginBottom: 10 }}>Resumo</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
              {[["Serve a", `${r.impliedServingTemp}°C`], ["PAC", `${r.pacPerKg} (alvo ${r.pacTarget})`], ["POD (doçura)", r.podPerKg], ["Sólidos totais", `${r.stPct}%`], ["Custo estimado", `R$${r.costPerKg}/kg`]].map(([k, v], i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 13.5, paddingBottom: 8, borderBottom: i < 4 ? `1px solid ${T.bg}` : "none" }}><span style={{ color: T.soft }}>{k}</span><span style={{ fontFamily: "'DM Mono', monospace", fontWeight: 500 }}>{v}</span></div>
              ))}
            </div>
          </div>
        </div>

        <div style={{ background: "#fff", borderRadius: 14, padding: "12px 16px", border: `1px solid ${T.line}`, marginBottom: 16 }}>
          <div style={{ fontSize: 10, letterSpacing: 1, color: T.gold, marginBottom: 8, fontWeight: 700 }}>MÉTODO DE BALANCEAMENTO</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            {[["classic", "Clássico (Corvitto)"], ["clean", "Autoral"]].map(([id, label]) => (
              <button key={id} onClick={() => setMethod(id)} style={{ background: method === id ? T.gold : "#fff", color: method === id ? "#fff" : T.soft, border: `1px solid ${method === id ? T.gold : T.line}`, borderRadius: 20, padding: "7px 15px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>{label}</button>
            ))}
          </div>
          {method === "classic" && <div style={{ fontSize: 11.5, color: T.soft, marginTop: 8 }}>Método do livro do Corvitto: ajusta o ponto de congelamento combinando açúcares (dextrose + invertido), mantendo a doçura.</div>}
          {method === "clean" && <div style={{ fontSize: 11.5, color: "#9a3b46", marginTop: 8 }}>Modo autoral (adaptação moderna, não é Corvitto clássico): sobe o PAC com eritritol e você repõe a doçura adicionando um adoçante intenso (stevia, monk fruit) como ingrediente, pela ficha técnica. Útil para versões com menos açúcar — a redução é decisão sua, escolhendo os ingredientes.</div>}
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12, paddingTop: 12, borderTop: `1px solid ${T.bg}`, flexWrap: "wrap" }}>
            <span style={{ fontSize: 10, letterSpacing: 1, color: T.gold, fontWeight: 700 }}>LINHA / ESCOLA</span>
            <select value={school} onChange={(e) => setSchool(e.target.value)} style={{ ...sel, width: "auto", padding: "6px 12px", fontSize: 12.5 }}>
              {["Autoral", "Corvitto", "De Giglio", "Cappellini", "Bella Cookery"].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <span style={{ fontSize: 11, color: T.soft }}>a escola/autor que inspira esta receita</span>
          </div>
        </div>

        <div style={{ background: "#fff", border: `1px solid ${T.line}`, borderRadius: 16, overflow: "hidden", marginBottom: 16, boxShadow: "0 1px 3px rgba(60,58,54,.04)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 18px", borderBottom: `1px solid ${T.line}` }}>
            <span style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 16, fontWeight: 600, color: T.ink }}>Ficha técnica · {targetWeight >= 1000 ? `${targetWeight / 1000}kg` : `${targetWeight}g`}</span>
            <button onClick={() => setModal(true)} style={{ background: T.goldBg, color: T.gold, border: `1px solid ${T.goldLine}`, borderRadius: 8, padding: "6px 12px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>+ ingrediente</button>
          </div>
          {pacSwap && recGrams && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "10px 18px", background: "#ffeaea", borderBottom: `1px solid ${T.line}`, flexWrap: "wrap" }}>
              <span style={{ fontSize: 13, color: "#c01f2f", fontWeight: 600, maxWidth: 760 }}>
                <b style={{ fontFamily: "'DM Mono', monospace" }}>⇒</b> para servir a {servingTemp}°C{recGrams._additions && recGrams._additions.length ? <> · adicionar {recGrams._additions.map((a) => `${a.grams}g de ${swapLabel(a.name)}`).join(" + ")}</> : null}
                <span style={{ display: "block", fontWeight: 500, color: "#9a3b46", fontSize: 11.5, marginTop: 2 }}>Blend dextrose + invertido (meio a meio): sobe o PAC mantendo a doçura praticamente igual — método Corvitto.</span>
              </span>
              <button onClick={() => applySwap(pacSwap)} style={{ background: "#c01f2f", color: "#fff", border: "none", borderRadius: 8, padding: "7px 15px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>Aplicar ajuste</button>
            </div>
          )}
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 600 }}>
              <thead><tr style={{ borderBottom: `1px solid ${T.line}` }}><th style={{ ...th, textAlign: "left" }}>Ingrediente</th><th style={th}>Peso (g)</th><th style={th}>Gord.</th><th style={th}>POD</th><th style={th}>SLNG</th><th style={th}>Sólidos</th><th style={th}>PAC</th></tr></thead>
              <tbody>{liveItems.length === 0 ? (
                <tr><td colSpan={7} style={{ padding: "28px 16px", textAlign: "center", color: T.soft, fontSize: 13.5 }}>Receita vazia. Clique em <b style={{ color: T.gold }}>+ ingrediente</b> e veja os parâmetros reais surgirem abaixo.</td></tr>
              ) : liveItems.map((it, i) => { const d = r.rows[i]; return (<tr key={i} style={{ borderBottom: `1px solid ${T.bg}` }}>
                <td style={{ padding: "4px 9px", fontSize: 13 }}><span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>{it.ingredient.name}<button onClick={() => removeItem(i)} style={{ background: "none", border: "none", color: "#ccc", cursor: "pointer", fontSize: 14 }}>×</button></span></td>
                <td style={{ padding: "3px 7px", textAlign: "right" }}><input type="number" value={it.grams} onChange={(e) => setGrams(i, e.target.value)} style={{ width: 58, background: T.bg, border: `1px solid ${T.line}`, borderRadius: 7, color: T.ink, padding: "4px 6px", fontFamily: "'DM Mono', monospace", fontSize: 12.5, textAlign: "right" }} />
                  {scale !== 1 && <span style={{ fontSize: 10, color: "#c4bdb2", display: "block" }}>→ {fmt2(d.g * scale)}</span>}
                  {recGrams && recGrams[i] != null && Math.round(recGrams[i]) !== Math.round(d.g) && <span style={{ fontSize: 10.5, color: "#c01f2f", fontWeight: 700, display: "block", fontFamily: "'DM Mono', monospace" }}>⇒ {fmt2(recGrams[i])}</span>}
                </td>
                <td style={cellNum}>{fmt2(d.fat)}</td><td style={cellNum}>{fmt2(d.pod)}</td><td style={cellNum}>{fmt2(d.msnf)}</td><td style={cellNum}>{fmt2(d.st)}</td><td style={cellNum}>{fmt2(d.pac)}</td>
              </tr>); })}</tbody>
              <tfoot><tr style={{ borderTop: `1.5px solid ${T.line}` }}><td style={{ padding: "9px", fontSize: 12, color: T.soft, fontWeight: 600 }}>TOTAL</td><td style={{ ...cellNum, fontWeight: 600 }}>{fmt2(r.totalGrams)}</td><td style={{ ...cellNum, fontWeight: 600 }}>{fmt2(r.totFat)}</td><td style={{ ...cellNum, fontWeight: 600 }}>{fmt2(r.totPod)}</td><td style={{ ...cellNum, fontWeight: 600 }}>{fmt2(r.totMsnf)}</td><td style={{ ...cellNum, fontWeight: 600 }}>{fmt2(r.totSt)}</td><td style={{ ...cellNum, fontWeight: 600 }}>{fmt2(r.totPac)}</td></tr></tfoot>
            </table>
          </div>
        </div>

        <MonitorPanel monitor={r.monitor} servingTemp={servingTemp} pacTarget={r.pacTarget} pacNow={r.pacPerKg} suggestions={r.suggestions} onApplySwap={applySwap} />

        <div style={{ background: "#fff", border: `1px solid ${T.line}`, borderRadius: 16, overflow: "hidden", marginTop: 16, marginBottom: 16, boxShadow: "0 1px 3px rgba(60,58,54,.04)" }}>
          <div style={{ padding: "12px 16px", borderBottom: `1px solid ${T.line}`, fontFamily: "'Fraunces', Georgia, serif", fontSize: 15, fontWeight: 600, color: T.ink }}>Observações</div>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notas sobre o sabor, harmonizações, dicas de serviço… (ex.: o cassis tem sabor tânico forte, ótimo com chocolate amargo)" style={{ width: "100%", border: "none", resize: "vertical", minHeight: 110, padding: "12px 16px", fontFamily: "inherit", fontSize: 13.5, lineHeight: 1.6, color: T.ink, background: "#fff", outline: "none", boxSizing: "border-box" }} />
        </div>

        <div style={{ background: "#fff", border: `1px solid ${T.line}`, borderRadius: 16, overflow: "hidden", marginBottom: 16, boxShadow: "0 1px 3px rgba(60,58,54,.04)" }}>
          <div style={{ padding: "12px 16px", borderBottom: `1px solid ${T.line}`, fontFamily: "'Fraunces', Georgia, serif", fontSize: 15, fontWeight: 600, color: T.ink }}>Modo de preparo</div>
          <textarea value={prep} onChange={(e) => setPrep(e.target.value)} placeholder={"Passo a passo da produção…\n\nEx.: Para gelatos de fruta, recomendo o processo a frio (com produtos pasteurizados) para preservar o sabor da fruta sem mascarar com o gosto de leite cozido. Se preferir pasteurizar, siga o procedimento dos outros gelatos e acrescente a fruta no fim da maturação, antes de mantecar."} style={{ width: "100%", border: "none", resize: "vertical", minHeight: 200, padding: "12px 16px", fontFamily: "inherit", fontSize: 13.5, lineHeight: 1.7, color: T.ink, background: "#fff", outline: "none", boxSizing: "border-box" }} />
        </div>
      </>)}
    </div>
  );
}
