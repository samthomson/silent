import { BrowserRouter, Route, Routes } from "react-router-dom";
import { ScrollToTop } from "./components/ScrollToTop";

import Index from "./pages/Index";
import { NIP19Page } from "./pages/NIP19Page";
import Test from "./pages/Test";
import NotFound from "./pages/NotFound";
import { NewDMProvider } from "./contexts/NewDMContext";
import { DMProvider, type DMConfig } from "./contexts/DMContext";
import { PROTOCOL_MODE } from "./lib/dmConstants";

const dmConfig: DMConfig = {
  enabled: true,
  protocolMode: PROTOCOL_MODE.NIP04_OR_NIP17,
};

export function AppRouter() {
  return (
    <BrowserRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
      <ScrollToTop />
      <Routes>
        <Route path="/" element={<DMProvider config={dmConfig}><Index /></DMProvider>} />
        <Route path="/test" element={<NewDMProvider><Test /></NewDMProvider>} />
        {/* NIP-19 route for npub1, note1, naddr1, nevent1, nprofile1 */}
        <Route path="/:nip19" element={<DMProvider config={dmConfig}><NIP19Page /></DMProvider>} />
        {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  );
}
export default AppRouter;