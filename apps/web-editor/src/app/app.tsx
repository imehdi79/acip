import { Route, Routes } from 'react-router-dom';

import HomePage from './pages/home';
import AdminPage from './pages/admin';

export function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/admin" element={<AdminPage />} />
    </Routes>
  );
}

export default App;
