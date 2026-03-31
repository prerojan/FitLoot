import { useState } from 'react';
import { useHealthData } from '../hooks/useHealthData';
import { useMapService } from '../hooks/useMapService';
import { formatStepsSourceLabel } from '../services/native/stepsService';

export default function HealthTest() {
  // Estados locais usados para os controles manuais do painel de teste.
  const [stepsInput, setStepsInput] = useState('');
  const [caloriesInput, setCaloriesInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  // Exibe e exercita o fluxo de leitura/atualizacao dos dados de saude.
  const {
    healthData,
    loading,
    error,
    isAuthenticated,
    lastSync,
    authenticate,
    fetchHealthData,
    addSteps,
    addCalories,
    stepsProgress,
    caloriesProgress,
  } = useHealthData({
    autoRefresh: true,
    refreshInterval: 1, // 1 minute for testing
  });

  // Exibe e exercita o fluxo de busca e geolocalizacao do mapa.
  const {
    mapState,
    userLocation,
    searchLocation,
    getCurrentLocation,
    addMarker,
    clearMarkers,
  } = useMapService({
    enableGeolocation: true,
  });

  // Injeta passos artificiais para validar o ciclo de atualizacao da UI.
  const handleAddSteps = async () => {
    const steps = parseInt(stepsInput);
    if (!isNaN(steps) && steps > 0) {
      await addSteps(steps);
      setStepsInput('');
    }
  };

  // Injeta calorias artificiais para validar o ciclo de atualizacao da UI.
  const handleAddCalories = async () => {
    const calories = parseInt(caloriesInput);
    if (!isNaN(calories) && calories > 0) {
      await addCalories(calories);
      setCaloriesInput('');
    }
  };

  // Busca um endereco e cria um marcador de validacao no mapa.
  const handleSearch = async () => {
    if (searchQuery.trim()) {
      try {
        const results = await searchLocation(searchQuery);
        if (results.length > 0) {
          const firstResult = results[0];
          if (firstResult) {
            addMarker({
              id: `search-${Date.now()}`,
              longitude: firstResult.coordinates?.[0] || 0,
              latitude: firstResult.coordinates?.[1] || 0,
              title: firstResult.placeName || 'Localização',
              description: firstResult.address || 'Endereço não disponível',
              color: 'red',
            });
          }
        }
      } catch (err) {
        console.error('Search failed:', err);
      }
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-4xl mx-auto space-y-6">
        <header className="bg-white rounded-lg shadow p-6">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">FitLoot Health Test</h1>
          <p className="text-gray-600">Teste de integração Google Fit e OpenStreetMap</p>
        </header>

        {/* Bloco de autenticacao e sincronizacao com a fonte de saude. */}
        <section className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold mb-4">Google Fit Status</h2>
          
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="font-medium">Autenticado:</span>
              <span className={`px-3 py-1 rounded-full text-sm ${
                isAuthenticated 
                  ? 'bg-green-100 text-green-800' 
                  : 'bg-red-100 text-red-800'
              }`}>
                {isAuthenticated ? 'Sim' : 'Não'}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="font-medium">Última sincronização:</span>
              <span className="text-sm text-gray-600">
                {lastSync ? lastSync.toLocaleTimeString() : 'Nunca'}
              </span>
            </div>

            {!isAuthenticated && (
              <button
                onClick={authenticate}
                disabled={loading}
                className="w-full bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {loading ? 'Autenticando...' : 'Autenticar com Google Fit'}
              </button>
            )}

            {(isAuthenticated || !isAuthenticated) && (
              <button
                onClick={fetchHealthData}
                disabled={loading}
                className="w-full bg-green-600 text-white py-2 px-4 rounded-lg hover:bg-green-700 disabled:opacity-50"
              >
                {loading ? 'Carregando...' : 'Atualizar Dados'}
              </button>
            )}
          </div>

          {error && (
            <div className="mt-4 p-3 bg-red-100 border border-red-300 rounded-lg text-red-700">
              {error}
            </div>
          )}
        </section>

        {/* Resumo das metricas carregadas a partir da fonte atual. */}
        {healthData && (
          <section className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-semibold mb-4">Dados de Saúde</h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Bloco de passos com progresso contra a meta diaria. */}
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="font-medium">Passos:</span>
                  <span className="text-2xl font-bold text-blue-600">
                    {healthData.steps.toLocaleString()}
                  </span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div 
                    className="bg-blue-600 h-2 rounded-full transition-all"
                    style={{ width: `${stepsProgress}%` }}
                  />
                </div>
                <p className="text-sm text-gray-600">{stepsProgress.toFixed(1)}% da meta (10.000)</p>
              </div>

              {/* Bloco de calorias com o mesmo padrao visual de progresso. */}
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="font-medium">Calorias:</span>
                  <span className="text-2xl font-bold text-orange-600">
                    {healthData.calories.toLocaleString()}
                  </span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div 
                    className="bg-orange-600 h-2 rounded-full transition-all"
                    style={{ width: `${caloriesProgress}%` }}
                  />
                </div>
                <p className="text-sm text-gray-600">{caloriesProgress.toFixed(1)}% da meta (500)</p>
              </div>

              {/* Distancia consolidada retornada pela integracao. */}
              <div>
                <div className="flex justify-between items-center">
                  <span className="font-medium">Distância:</span>
                  <span className="text-xl font-semibold text-green-600">
                    {healthData.distance} km
                  </span>
                </div>
              </div>

              {/* Tempo de atividade consolidado pela integracao. */}
              <div>
                <div className="flex justify-between items-center">
                  <span className="font-medium">Minutos Ativos:</span>
                  <span className="text-xl font-semibold text-purple-600">
                    {healthData.activeMinutes}
                  </span>
                </div>
              </div>
            </div>

            <div className="mt-4 p-3 bg-gray-100 rounded-lg">
              <p className="text-sm text-gray-600">
                Fonte: {formatStepsSourceLabel(healthData.source)}
              </p>
            </div>
          </section>
        )}

        {/* Controles de injecao manual para testar mutacoes locais. */}
        <section className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold mb-4">Adicionar Dados Manualmente</h2>
          
          <div className="space-y-4">
            <div className="flex gap-2">
              <input
                type="number"
                placeholder="Passos"
                value={stepsInput}
                onChange={(e) => setStepsInput(e.target.value)}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                onClick={handleAddSteps}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
              >
                Adicionar Passos
              </button>
            </div>

            <div className="flex gap-2">
              <input
                type="number"
                placeholder="Calorias"
                value={caloriesInput}
                onChange={(e) => setCaloriesInput(e.target.value)}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
              />
              <button
                onClick={handleAddCalories}
                className="bg-orange-600 text-white px-4 py-2 rounded-lg hover:bg-orange-700"
              >
                Adicionar Calorias
              </button>
            </div>
          </div>
        </section>

        {/* Painel de validacao do fluxo de mapa e geolocalizacao. */}
        <section className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold mb-4">Teste de Mapa (OpenStreetMap)</h2>
          
          <div className="space-y-4">
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Buscar localização..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
              />
              <button
                onClick={handleSearch}
                className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700"
              >
                Buscar
              </button>
            </div>

            <div className="flex gap-2">
              <button
                onClick={getCurrentLocation}
                className="bg-purple-600 text-white px-4 py-2 rounded-lg hover:bg-purple-700"
              >
                Minha Localização
              </button>
              <button
                onClick={clearMarkers}
                className="bg-gray-600 text-white px-4 py-2 rounded-lg hover:bg-gray-700"
              >
                Limpar Marcadores
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div>
                <span className="font-medium">Localização do usuário:</span>
                <p className="text-gray-600">
                  {userLocation 
                    ? `${userLocation[1].toFixed(4)}, ${userLocation[0].toFixed(4)}`
                    : 'Não disponível'
                  }
                </p>
              </div>
              <div>
                <span className="font-medium">Centro do mapa:</span>
                <p className="text-gray-600">
                  {mapState.center[1].toFixed(4)}, {mapState.center[0].toFixed(4)}
                </p>
              </div>
              <div>
                <span className="font-medium">Zoom:</span>
                <p className="text-gray-600">{mapState.zoom}</p>
              </div>
              <div>
                <span className="font-medium">Marcadores:</span>
                <p className="text-gray-600">{mapState.markers.length}</p>
              </div>
            </div>
          </div>
        </section>

        {/* Estado bruto do sistema para depuracao rapida do ambiente. */}
        <section className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold mb-4">Status do Sistema</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div>
              <span className="font-medium">Carregando:</span>
              <p className="text-gray-600">{loading ? 'Sim' : 'Não'}</p>
            </div>
            <div>
              <span className="font-medium">Erro:</span>
              <p className="text-gray-600">{error || 'Nenhum'}</p>
            </div>
            <div>
              <span className="font-medium">Mapa carregado:</span>
              <p className="text-gray-600">
                {mapState.isLoading ? 'Carregando' : 'Pronto'}
              </p>
            </div>
            <div>
              <span className="font-medium">Erro do mapa:</span>
              <p className="text-gray-600">{mapState.error || 'Nenhum'}</p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
