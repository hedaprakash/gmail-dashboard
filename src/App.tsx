import { Routes, Route } from 'react-router-dom';
import Layout from './components/Layout/Layout';
import Review from './pages/Review';
import Stats from './pages/Stats';
import CriteriaManager from './pages/CriteriaManager';
import Execute from './pages/Execute';

function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Review />} />
        <Route path="/stats" element={<Stats />} />
        <Route path="/criteria" element={<CriteriaManager />} />
        <Route path="/criteria/:type" element={<CriteriaManager />} />
        <Route path="/execute" element={<Execute />} />
      </Routes>
    </Layout>
  );
}

export default App;
