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

## 🔒 Login administrativo — 3 níveis de acesso

A tela principal de gestão é protegida por senha, e existem **3 senhas diferentes**, cada uma
liberando um nível de acesso distinto. O sistema identifica automaticamente o papel da pessoa
pela senha que ela digitar — não existe seleção manual de "tipo de usuário".

| Papel | Variável no Vercel | Abas visíveis |
|---|---|---|
| **Gestor** (você) | `VITE_OWNER_PASSWORD` | Mecânicos, Clientes/OS, Estoque, Financeiro (tudo) |
| **Administrativo** | `VITE_ADMIN_PASSWORD` | Mecânicos, Clientes/OS, Estoque (sem Financeiro) |
| **Chefe de Oficina** | `VITE_SUPERVISOR_PASSWORD` | Mecânicos, Estoque (apenas) |

**Como configurar as 3 senhas:**

1. No painel do Vercel → seu projeto → **Settings** → **Environment Variables**
2. Adicione as três variáveis, uma de cada vez:
   - **Key**: `VITE_OWNER_PASSWORD` / **Value**: sua senha de gestor
   - **Key**: `VITE_ADMIN_PASSWORD` / **Value**: senha do time administrativo
   - **Key**: `VITE_SUPERVISOR_PASSWORD` / **Value**: senha dos chefes de oficina
3. Para cada uma, marque todos os ambientes (Production, Preview, Development) → **Save**
4. Depois de adicionar as três, vá em **Deployments** → três pontinhos do último deploy →
   **Redeploy** (obrigatório para as variáveis entrarem em vigor)

**Trocar uma senha depois:** vá em Environment Variables → editar a variável correspondente →
salvar → Redeploy. As outras senhas continuam funcionando normalmente.

Cada pessoa só precisa saber a senha do seu próprio nível — elas não revelam nada sobre as
outras. A sessão dura enquanto a aba do navegador estiver aberta.

Os links públicos continuam sem qualquer senha, como já era:
- `?portal=mecanico` — área dos mecânicos (login por WhatsApp, sem ver preços)
- `?v=ID_DO_VEICULO` — acompanhamento do cliente (sem login, sem ver preços internos)



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
