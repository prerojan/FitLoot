/**
 * Serviço de fallback para integração com Health Connect.
 * Mantém uma implementação web simulada para preservar o contrato do app.
 */

export interface HealthData {
  steps: number;
  calories: number;
  distance: number;
  heartRate?: number;
  activeMinutes: number;
  timestamp: string;
}

export interface HealthConnectPermissions {
  readSteps: boolean;
  writeSteps: boolean;
  readCalories: boolean;
  writeCalories: boolean;
  readHeartRate: boolean;
  writeHeartRate: boolean;
  readDistance: boolean;
  writeDistance: boolean;
  readActiveCalories: boolean;
  writeActiveCalories: boolean;
}

class HealthConnectService {
  private isAvailable: boolean = false;
  private permissions: HealthConnectPermissions = {
    readSteps: false,
    writeSteps: false,
    readCalories: false,
    writeCalories: false,
    readHeartRate: false,
    writeHeartRate: false,
    readDistance: false,
    writeDistance: false,
    readActiveCalories: false,
    writeActiveCalories: false,
  };

  constructor() {
    this.checkAvailability();
  }

  // Determina se o ambiente atual realmente suporta Health Connect.
  private async checkAvailability(): Promise<void> {
    this.isAvailable = false;
    return;
  }

  // Expõe a disponibilidade detectada para o restante da aplicação.
  async getAvailability(): Promise<boolean> {
    return false;
  }

  // Solicita as permissões mínimas exigidas pelo fluxo de saúde.
  async requestPermissions(): Promise<boolean> {
    if (!this.isAvailable) {
      throw new Error('Health Connect is not available on this device');
    }

    try {
      await new Promise(resolve => setTimeout(resolve, 1000));

      this.permissions = {
        readSteps: true,
        writeSteps: true,
        readCalories: true,
        writeCalories: true,
        readHeartRate: true,
        writeHeartRate: true,
        readDistance: true,
        writeDistance: true,
        readActiveCalories: true,
        writeActiveCalories: true,
      };

      return true;
    } catch (error) {
      console.error('Health Connect permission request failed:', error);
      return false;
    }
  }

  // Retorna o snapshot atual de permissões concedidas.
  async checkPermissions(): Promise<HealthConnectPermissions> {
    return this.permissions;
  }

  // Lê o resumo diário mantendo o formato compatível com o app.
  async readTodayData(): Promise<HealthData> {
    if (!this.isAvailable) {
      throw new Error('Health Connect is not available on this device');
    }

    if (!this.hasReadPermissions()) {
      throw new Error('Read permissions not granted');
    }

    try {
      const now = new Date();

      return {
        steps: Math.floor(Math.random() * 15000) + 5000,
        calories: Math.floor(Math.random() * 500) + 200,
        distance: Math.floor(Math.random() * 10000) / 1000, // km
        heartRate: Math.floor(Math.random() * 40) + 60, // bpm
        activeMinutes: Math.floor(Math.random() * 120) + 30,
        timestamp: now.toISOString(),
      };
    } catch (error) {
      console.error('Failed to read health data:', error);
      throw new Error('Failed to read health data from Health Connect');
    }
  }

  // Mantém a escrita simulada para preservar a API do serviço.
  async writeHealthData(data: Partial<HealthData>): Promise<void> {
    if (!this.isAvailable) {
      throw new Error('Health Connect is not available on this device');
    }

    if (!this.hasWritePermissions()) {
      throw new Error('Write permissions not granted');
    }

    try {
      console.log('Writing health data to Health Connect:', data);

      await new Promise(resolve => setTimeout(resolve, 500));

      console.log('Health data written successfully');
    } catch (error) {
      console.error('Failed to write health data:', error);
      throw new Error('Failed to write health data to Health Connect');
    }
  }

  // Gera um histórico compatível com o contrato esperado pelo frontend.
  async readHistoricalData(startDate: Date, endDate: Date): Promise<HealthData[]> {
    if (!this.isAvailable) {
      throw new Error('Health Connect is not available on this device');
    }

    if (!this.hasReadPermissions()) {
      throw new Error('Read permissions not granted');
    }

    try {
      const data: HealthData[] = [];
      const current = new Date(startDate);
      
      while (current <= endDate) {
        data.push({
          steps: Math.floor(Math.random() * 15000) + 5000,
          calories: Math.floor(Math.random() * 500) + 200,
          distance: Math.floor(Math.random() * 10000) / 1000,
          heartRate: Math.floor(Math.random() * 40) + 60,
          activeMinutes: Math.floor(Math.random() * 120) + 30,
          timestamp: current.toISOString(),
        });
        
        current.setDate(current.getDate() + 1);
      }
      
      return data;
    } catch (error) {
      console.error('Failed to read historical health data:', error);
      throw new Error('Failed to read historical health data from Health Connect');
    }
  }

  // Resume a leitura mínima exigida pelo fluxo ativo do app.
  private hasReadPermissions(): boolean {
    return this.permissions.readSteps && 
           this.permissions.readCalories && 
           this.permissions.readDistance;
  }

  // Resume a escrita mínima exigida pelo fluxo ativo do app.
  private hasWritePermissions(): boolean {
    return this.permissions.writeSteps && 
           this.permissions.writeCalories && 
           this.permissions.writeDistance;
  }

  // Preserva o contrato para abertura de configurações nativas.
  async openSettings(): Promise<void> {
    if (!this.isAvailable) {
      throw new Error('Health Connect is not available on this device');
    }

    try {
      console.log('Opening Health Connect settings...');
    } catch (error) {
      console.error('Failed to open Health Connect settings:', error);
      throw new Error('Failed to open Health Connect settings');
    }
  }
}

export const healthConnectService = new HealthConnectService();
export default healthConnectService;
