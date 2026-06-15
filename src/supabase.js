import { createClient } from "@supabase/supabase-js";

// =====================================================================
// CONEXÃO COM O SEU BANCO (Supabase)
// ---------------------------------------------------------------------
// Estes dois valores são lidos das "Environment Variables" que você vai
// configurar no Vercel (e no arquivo .env.local para testar localmente).
// NÃO escreva suas chaves direto aqui — elas ficam nas variáveis.
// =====================================================================
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(url, key);

// ---- Receitas (cada usuário só enxerga as próprias, garantido pelo RLS) ----

export async function listarReceitas() {
  const { data, error } = await supabase
    .from("receitas")
    .select("*")
    .order("atualizado_em", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function salvarReceita(receita, donoId) {
  // receita: objeto do app. Convertendo para as colunas do banco.
  const linha = {
    dono: donoId,
    nome: receita.name,
    tipo: receita.kind,
    familia: receita.family,
    equipamento: receita.equipment,
    escola: receita.school,
    chef: receita.chef,
    temp_servico: receita.servingTemp,
    peso_alvo: receita.targetWeight,
    itens: receita.items,
    foto: receita.photo,
    observacoes: receita.notes,
    preparo: receita.prep,
    atualizado_em: new Date().toISOString(),
  };
  // Se a receita já tem id do banco, atualiza; senão, cria.
  if (receita.dbId) {
    const { data, error } = await supabase
      .from("receitas").update(linha).eq("id", receita.dbId).select().single();
    if (error) throw error;
    return data;
  } else {
    const { data, error } = await supabase
      .from("receitas").insert(linha).select().single();
    if (error) throw error;
    return data;
  }
}

export async function apagarReceita(dbId) {
  const { error } = await supabase.from("receitas").delete().eq("id", dbId);
  if (error) throw error;
}

// Converte uma linha do banco de volta para o formato que o app usa.
export function linhaParaApp(linha) {
  return {
    id: linha.id,
    dbId: linha.id,
    name: linha.nome,
    kind: linha.tipo,
    family: linha.familia,
    equipment: linha.equipamento,
    school: linha.escola,
    chef: linha.chef,
    servingTemp: linha.temp_servico,
    targetWeight: linha.peso_alvo,
    items: linha.itens || [],
    photo: linha.foto,
    notes: linha.observacoes,
    prep: linha.preparo,
  };
}
