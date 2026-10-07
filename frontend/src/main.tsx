import React from 'react';
import ReactDOM from 'react-dom/client';
import { AgGridProvider } from 'ag-grid-react';
import { ClientSideRowModelModule, RowStyleModule, ValidationModule } from 'ag-grid-community';
import { WorkspaceProvider } from './lib/store';
import App from './App';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AgGridProvider
      modules={[
        ClientSideRowModelModule,
        RowStyleModule,
        ...(import.meta.env.DEV ? [ValidationModule] : []),
      ]}
    >
      <WorkspaceProvider>
        <App />
      </WorkspaceProvider>
    </AgGridProvider>
  </React.StrictMode>,
);
