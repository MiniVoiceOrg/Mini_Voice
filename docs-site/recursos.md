# Recursos

- Voz de baixa latência via WebRTC, direto entre os participantes (P2P Mesh) e sem o áudio passar pelo servidor.
- Modo SFU opcional (`mediasoup`): cada pessoa envia seu fluxo uma única vez e o servidor distribui aos demais, para grupos maiores e para quem compartilha tela em alta resolução. O app e a CLI trazem um estimador de capacidade para dimensionar o host antes de ligar.
- Detecção de fala (VAD) com sensibilidade ajustável e medidor ao vivo.
- Supressão de ruído com IA (RNNoise).
- Câmera com resolução e bitrate adaptativos.
- Compartilhamento de tela ou janela, com áudio.
- Chat com histórico persistente, avatares e proteção anti-flood.
- Canais privados com visibilidade por cargo: quem não tem acesso não recebe o canal do servidor, nem o nome.
- Soundboard a partir de uma pasta do PC, com controle do anfitrião.
- Descoberta automática de servidores na rede local.
- Vários servidores conectados ao mesmo tempo: trocar de servidor não derruba a chamada de voz nem faz você perder mensagens.
- Perfis de qualidade: Econômico, Normal, Alta Qualidade e Gaming.
- Servidor self-hosted com SQLite, senhas com `scrypt` e validação rigorosa de upload de avatares.
- Monitor do Servidor no app: métricas ao vivo (tempo ativo, conectados, membros, canais, mensagens) e logs com filtro por nível.
- Administração por linha de comando com o [Monky CLI](/cli), para VPS e servidores sem interface gráfica.
