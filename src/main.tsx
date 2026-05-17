import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App';
import './index.css';
import { doc, getDocFromCache, getDocFromServer } from 'firebase/firestore';
import { db } from './services/firebase';

// Connection Test
async function testConnection() {
  try {
    // Attempt to read a non-existent doc just to check connectivity
    await getDocFromServer(doc(db, 'system', 'connection_test'));
    console.log('Firebase Connected Successfully');
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error("Please check your Firebase configuration or internet connection.");
    } else {
      console.log('Firebase connection ready (ignoring expected 403/404 if rules/doc dont exist)');
    }
  }
}

testConnection();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
