import '@/app/app.css';
import MainWrapper from '@/app/components/layout/wrapper/MainWrapper';
import Header from './components/layout/header';
import Footer from './components/layout/footer';

export function App() {
  return (
    <MainWrapper>
      <Header />
      <div className="">
        <Footer />
      </div>
    </MainWrapper>
  );
}
export default App;
