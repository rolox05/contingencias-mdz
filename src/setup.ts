import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

import { configureHttp, configureSmnStore, NO_CORS_HOSTS } from '@alerta/core';

/**
 * Configuración del núcleo compartido para la app. Se importa antes que nada
 * (layout raíz y revisión en segundo plano).
 */

// Los archivos de alertas del SMN ya descargados se guardan en el teléfono.
configureSmnStore(AsyncStorage);

// En la versión web los hosts oficiales sin CORS pasan por el proxy de desarrollo
// (src/app/proxy+api.ts). Las apps nativas los consultan directo.
if (Platform.OS === 'web') {
  configureHttp({
    resolveUrl: (url) => {
      const host = url.replace(/^https?:\/\//, '').split('/')[0];
      return NO_CORS_HOSTS.includes(host) ? `/proxy?url=${encodeURIComponent(url)}` : url;
    },
  });
}
