# OSC Performance — Gestão de Oficina

Sistema interno de gestão de oficina mecânica com banco de dados em nuvem (Supabase),
fotos de OS, estoque com markup automático e link público de acompanhamento para clientes.

## 🔐 Acesso dos mecânicos

Cada mecânico acessa sua própria área (sem ver preços, outros mecânicos ou clientes) através do link:

```
https://seu-dominio.vercel.app/?portal=mecanico
```

Ele entra digitando o número de WhatsApp cadastrado pelo gestor. Esse link já é incluído
automaticamente na mensagem de WhatsApp enviada para o mecânico, e também pode ser copiado
pelo botão de cadeado 🔒 no topo do painel do gestor.

## 💰 Financeiro e Conta Corrente

- A aba **Financeiro** contabiliza receita, custo de material e lucro automaticamente
  conforme as tarefas são marcadas como concluídas — sem nenhuma ação manual extra.
- Cada veículo tem um botão **Conta** (verde) que abre a conta corrente: lançamento de
  pagamentos (valor, data, método) e cálculo automático do saldo devedor, mesmo que a OS
  continue crescendo com novas tarefas ao longo do tempo.

## 🔒 Login administrativo (acesso do gestor)

Toda a área de gestão (Mecânicos, Clientes/OS, Estoque, Financeiro) fica protegida por senha.
Sem essa senha, ninguém que encontrar o link principal consegue ver preços, clientes ou dados
financeiros — apenas você, como gestor.

**Como configurar a senha:**

1. No painel do Vercel, vá no seu projeto → **Settings** → **Environment Variables**
2. Adicione uma nova variável:
   - **Key**: `VITE_ADMIN_PASSWORD`
   - **Value**: a senha que você quiser (ex: `oficina2026!`)
   - **Environment**: marque todas (Production, Preview, Development)
3. Clique em **Save**
4. Vá em **Deployments** → nos três pontinhos do último deploy → **Redeploy** (precisa redeployar
   para a variável entrar em vigor)

A partir daí, ao acessar `osc-performance.vercel.app`, será exigida essa senha antes de mostrar
qualquer informação. A sessão fica salva apenas durante a aba aberta (fecha o navegador, pede
senha de novo — por segurança).

**Importante:** os links públicos continuam abertos sem senha, como esperado:
- `?portal=mecanico` — área dos mecânicos (login por WhatsApp, sem ver preços)
- `?v=ID_DO_VEICULO` — acompanhamento do cliente (sem login, sem ver preços internos)

Apenas a tela principal (gestão completa) exige a senha de administrador.



```bash
npm install
npm run dev
```

Abra http://localhost:5173

## 📦 Como hospedar no Vercel (gratuito)

1. Crie um repositório no GitHub e suba esta pasta inteira (exceto `node_modules`, já ignorado).
2. Acesse vercel.com → "Add New Project" → importe o repositório do GitHub.
3. O Vercel detecta automaticamente que é um projeto Vite. Não precisa configurar nada.
4. Clique em "Deploy". Em ~1 minuto você terá um link público, ex: `osc-performance.vercel.app`.

## 🔄 Fazendo atualizações depois

Sempre que você (ou eu) gerar uma nova versão do código:

1. Suba as mudanças no mesmo repositório do GitHub (`git push` ou substituir os arquivos
   diretamente na interface do GitHub).
2. O Vercel detecta o push e faz redeploy automaticamente.
3. **Os dados continuam intactos** — eles vivem no banco de dados Supabase, totalmente
   independente do código do site. Atualizar o site não afeta os dados, nunca.

## 🗄️ Sobre o banco de dados

Os dados (mecânicos, clientes, veículos, tarefas, estoque) ficam armazenados no Supabase,
um banco de dados Postgres na nuvem. Isso significa:

- Funciona em qualquer dispositivo (celular, computador, tablet) com os mesmos dados sincronizados.
- As fotos ficam no Supabase Storage (bucket `photos`), não no banco principal — isso mantém
  o sistema rápido mesmo com muitas fotos.
- Para ver/gerenciar os dados diretamente, acesse supabase.com → seu projeto → Table Editor.

## ⚙️ Variáveis de configuração

As credenciais do Supabase (URL + chave pública "anon") estão hardcoded em `src/supabase.js`.
Isso é seguro porque a chave "anon" é pública por design — ela só permite o que as políticas
de acesso (RLS) do banco autorizam. Não exponha a "service role key" (essa sim é secreta) em
nenhum lugar do código.

## 📁 Estrutura do projeto

```
osc-performance/
├── index.html
├── package.json
├── vite.config.js
├── schema.sql          ← script SQL para criar as tabelas no Supabase
└── src/
    ├── main.jsx        ← ponto de entrada
    ├── App.jsx          ← aplicação completa (toda a interface)
    └── supabase.js      ← cliente Supabase + funções de acesso a dados
```
