import '@/app/app.css';
import MainWrapper from '@/app/components/layout/wrapper/MainWrapper';
import Header from './components/layout/header';
import Footer from './components/layout/footer';
import { EditorView } from '@/editor';
import ProjectSelector from './components/layout/views/project-selector';
import SignIn from './components/layout/views/sign-in';
import {
  useSettingsStore,
  useShowFooter,
  useShowHeader,
} from '@/app/stores/global/settings.store';

export function App() {
  const showHeader = useShowHeader();
  const showFooter = useShowFooter();
  const user = useSettingsStore((state) => state.user);
  const signIn = useSettingsStore((state) => state.signIn);
  const view = useSettingsStore((state) => state.view);

  // A null user means they have not chosen how to enter yet — guest is a real
  // choice, so it is stored as a guest-role user rather than left as null.
  if (!user) {
    return (
      <MainWrapper>
        <SignIn
          onSignIn={({ email }) =>
            // No auth backend yet: accept the email and treat them as an editor.
            signIn({ id: email, name: email, role: 'editor' })
          }
          onGuest={() => signIn({ id: 'guest', name: 'Guest', role: 'guest' })}
        />
      </MainWrapper>
    );
  }

  return (
    <MainWrapper>
      {showHeader && <Header />}
      <div className="flex-1 min-h-0">
        {view === 'editor' ? <EditorView /> : <ProjectSelector />}
      </div>
      {showFooter && <Footer />}
    </MainWrapper>
  );
}
export default App;
