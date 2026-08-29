# Templates de Comentário Obrigatório (AGENTS.md)

Ao finalizar a revisão ou implementação de um PR/Issue, utilize os modelos estruturados abaixo para manter a rastreabilidade e facilitar a validação pelo time de QA.

---

## 📝 Modelo de Comentário para Issue / PR (em PT-BR)

```markdown
### 💡 Como foi implementado & Decisões Técnicas

- **Resumo Didático:** [Explicação clara do que foi resolvido e do conceito aplicado]
- **Arquivos & Camadas Alteradas:**
  - `apps/client/src/...`: [Mudanças realizadas e motivo]
  - `packages/shared/src/...`: [Tipos/contratos ajustados]
- **Boas Práticas Aplicadas:** [Ex.: remoção de event listeners para evitar memory leaks, tipagem estrita de IPC, isolamento de camadas]

---

### 🧪 Como testar (Guia de Validação para QA)

1. **Pré-requisitos:** [Ex.: Iniciar servidor local / conectar 2 clientes / abrir tela de configurações]
2. **Cenário Principal:**
   - Passo 1: [Ação]
   - Passo 2: [Ação]
   - **Resultado Esperado:** [Comportamento correto do app]
3. **Casos de Borda & Resiliência:**
   - [Ex.: Testar desconexão de rede, fechar modal repetidamente, mutar/desmutar rápido, reiniciar app]
   - **Resultado Esperado:** [Ausência de erros no console ou travamentos]
```

---

## 💻 Comando para Inserir Comentário via GitHub CLI

```bash
gh issue comment <NUMERO_DA_ISSUE> --body "<conteudo_formatado>"
```

Ou para comentar diretamente no PR:

```bash
gh pr comment <NUMERO_DO_PR> --body "<conteudo_formatado>"
```
