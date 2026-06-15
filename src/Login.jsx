import React, { useState } from "react";
import { supabase } from "./supabase";

// Tela de entrar / criar conta. Aparece quando ninguém está logado.
export default function Login() {
  const [modo, setModo] = useState("entrar"); // entrar | criar
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState("");
  const [carregando, setCarregando] = useState(false);
  const [aviso, setAviso] = useState("");

  const T = { gold: "#b08d3f", ink: "#3c3a36", soft: "#6b6456", line: "#e4ddcd", bg: "#f6f1e8" };

  async function enviar() {
    setErro(""); setAviso(""); setCarregando(true);
    try {
      if (modo === "criar") {
        const { error } = await supabase.auth.signUp({ email, password: senha });
        if (error) throw error;
        setAviso("Conta criada! Você já pode entrar.");
        setModo("entrar");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password: senha });
        if (error) throw error;
        // ao logar, o app recarrega sozinho pelo listener
      }
    } catch (e) {
      setErro(traduzErro(e.message));
    } finally {
      setCarregando(false);
    }
  }

  function traduzErro(msg) {
    if (/invalid login/i.test(msg)) return "E-mail ou senha incorretos.";
    if (/already registered/i.test(msg)) return "Esse e-mail já tem conta. Tente entrar.";
    if (/at least 6/i.test(msg)) return "A senha precisa ter ao menos 6 caracteres.";
    if (/unable to validate email|invalid email/i.test(msg)) return "E-mail inválido.";
    return msg;
  }

  const input = { width: "100%", boxSizing: "border-box", background: "#fff", border: `1px solid ${T.line}`, borderRadius: 10, padding: "12px 14px", fontSize: 15, color: T.ink, outline: "none", marginBottom: 12 };

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: T.bg, padding: 24, fontFamily: "'Inter', system-ui, sans-serif" }}>
      <div style={{ width: "100%", maxWidth: 380, background: "#fff", border: `1px solid ${T.line}`, borderRadius: 20, padding: 28, boxShadow: "0 4px 24px rgba(60,58,54,.08)" }}>
        <div style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 28, fontWeight: 600, color: T.ink, marginBottom: 2 }}>GelatoLab</div>
        <div style={{ fontSize: 12.5, letterSpacing: 1, textTransform: "uppercase", color: T.gold, fontWeight: 700, marginBottom: 22 }}>Balanceamento de autor</div>

        <div style={{ fontSize: 14, color: T.soft, marginBottom: 16 }}>{modo === "entrar" ? "Entre na sua conta para acessar suas receitas." : "Crie sua conta para começar a salvar receitas."}</div>

        <input style={input} type="email" placeholder="seu e-mail" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        <input style={input} type="password" placeholder="sua senha" value={senha} onChange={(e) => setSenha(e.target.value)} autoComplete={modo === "criar" ? "new-password" : "current-password"} onKeyDown={(e) => e.key === "Enter" && enviar()} />

        {erro && <div style={{ fontSize: 13, color: "#c01f2f", marginBottom: 12 }}>{erro}</div>}
        {aviso && <div style={{ fontSize: 13, color: "#1a7d54", marginBottom: 12 }}>{aviso}</div>}

        <button onClick={enviar} disabled={carregando || !email || !senha} style={{ width: "100%", background: T.gold, color: "#fff", border: "none", borderRadius: 10, padding: "13px", fontSize: 15, fontWeight: 700, cursor: carregando ? "default" : "pointer", opacity: carregando || !email || !senha ? 0.6 : 1 }}>
          {carregando ? "Aguarde…" : modo === "entrar" ? "Entrar" : "Criar conta"}
        </button>

        <div style={{ textAlign: "center", marginTop: 16, fontSize: 13.5, color: T.soft }}>
          {modo === "entrar" ? (
            <>Ainda não tem conta? <span onClick={() => { setModo("criar"); setErro(""); }} style={{ color: T.gold, fontWeight: 600, cursor: "pointer" }}>Criar conta</span></>
          ) : (
            <>Já tem conta? <span onClick={() => { setModo("entrar"); setErro(""); }} style={{ color: T.gold, fontWeight: 600, cursor: "pointer" }}>Entrar</span></>
          )}
        </div>
      </div>
    </div>
  );
}
