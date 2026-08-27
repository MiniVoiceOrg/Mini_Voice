# Criar Seu Servidor

Na aba **Meus Servidores › Criar Servidor**, preencha nickname do anfitrião, nome do servidor, porta local, senha opcional e os canais iniciais de texto e voz.

Clique em **Criar e Iniciar Servidor**. O servidor sobe na sua máquina, escuta em todas as interfaces de rede na porta escolhida e você entra automaticamente.

Servidores criados ficam salvos (até 10). Depois, use **Iniciar**, **Parar** ou **X** na aba *Meus Servidores*.

## Convidar amigos

Dentro do servidor, clique no **nome do servidor** › **Convidar Amigos**. O app mostra nome, IP público e porta, e copia o convite.

| Situação | IP que seus amigos devem usar |
|---|---|
| Mesma rede local | Seu IP local, ou a descoberta automática do app |
| Outra internet | Seu IP público + porta liberada no roteador |
| Sem mexer no roteador | IP da VPN, como Radmin VPN, Hamachi, ZeroTier ou Tailscale |

## Liberar acesso pela internet

Libere a porta no firewall, faça port forwarding da porta `3000` (ou a escolhida) para o IP local do PC e use VPN se o provedor estiver atrás de CGNAT.

## Administrar

Em **Configurações do Servidor** é possível renomear o servidor, alterar/remover senha e permitir ou bloquear o soundboard. Os cabeçalhos de canais têm **+** para criar e lixeira para apagar.

## Monitor do Servidor

Enquanto o servidor está rodando na sua máquina, o app mostra o que está acontecendo dentro dele. Abra pelo ícone de **monitoramento** ao lado do botão *Parar*, na aba *Meus Servidores*, ou pelo **nome do servidor › Monitor do Servidor** quando já estiver conectado.

O painel traz:

- **Métricas ao vivo**, atualizadas a cada 3 segundos: tempo ativo, pessoas conectadas (e o limite), membros registrados, canais e mensagens.
- **Logs em tempo real**, com filtro por nível (`INFO`, `WARN`, `ERROR`), busca por texto, rolagem automática, botão para copiar o que está visível e botão para limpar.

O app guarda os registros mais recentes em memória — ao reiniciar o servidor, a lista recomeça. Para servidores rodando numa VPS, use [`monky logs`](/hospedar-em-vps).
