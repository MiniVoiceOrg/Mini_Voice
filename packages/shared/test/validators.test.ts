import {
  isValidMessageContent,
  isValidNickname,
  LIMITS,
  QUALITY_PRESETS,
  PROTOCOL_VERSION,
} from '../src/index.js';

console.log('=== Início dos Testes Unitários de @monky/shared ===');

// Test Nickname validation
console.assert(isValidNickname('Murilo') === true, 'Murilo deve ser válido');
console.assert(isValidNickname('Joao_123') === true, 'Joao_123 deve ser válido');
console.assert(isValidNickname('A') === false, '1 caractere deve ser inválido');
console.assert(isValidNickname('a'.repeat(33)) === false, '33 caracteres deve ser inválido');
console.assert(isValidNickname('Murilo<script>') === false, 'Caracteres especiais inválidos');
console.log('✔ Validações de Nickname passaram');

// Test Message validation
console.assert(isValidMessageContent('Olá mundo') === true, 'Mensagem normal válida');
console.assert(isValidMessageContent('') === false, 'Mensagem vazia inválida');
console.assert(isValidMessageContent('a'.repeat(2001)) === false, 'Mensagem acima de 2000 chars inválida');
console.assert(isValidMessageContent('a'.repeat(2000)) === true, 'Mensagem de 2000 chars válida');
console.log('✔ Validações de Mensagem passaram');

// Test Quality Presets
console.assert(QUALITY_PRESETS.ECONOMIC.audioBitrateKbps === 24, 'Preset Econômico de áudio');
console.assert(QUALITY_PRESETS.NORMAL.audioBitrateKbps === 32, 'Preset Normal de áudio');
console.assert(QUALITY_PRESETS.HIGH.audioBitrateKbps === 48, 'Preset Alta de áudio');
console.assert(QUALITY_PRESETS.GAMING.name === 'Gaming Mode', 'Preset Gaming Mode');
console.log('✔ Presets de Qualidade verificados');

// Test Protocol Version
console.assert(PROTOCOL_VERSION === 1, 'Versão do protocolo deve ser 1');
console.log('✔ Versão do protocolo verificada');

console.log('=== Todos os testes unitários passaram com sucesso! ===');
