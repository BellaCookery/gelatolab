import React, { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { supabase } from "./supabase";
import Login from "./Login";
import GelatoLab from "./GelatoLab";

function App() {
  const [sessao, setSessao] = useState(undefined); // undefined = carregando

  useEffect(() => {
    // pega a sessão atual ao abrir
    supabase.auth.getSession().then(({ data }) => setSessao(data.session));
    // escuta login/logout
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSessao(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (sessao === undefined) {
    return <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f6f1e8", color: "#6b6456", fontFamily: "system-ui" }}>Carregando…</div>;
  }
  if (!sessao) return <Login />;
  return <GelatoLab session={sessao} />;
}

createRoot(document.getElementById("root")).render(<App />);
