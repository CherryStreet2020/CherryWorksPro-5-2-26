import { useEffect } from "react";

export function useDocumentTitle(pageTitle: string) {
  useEffect(() => {
    document.title = `${pageTitle} | CherryWorks Pro`;
    return () => { document.title = "CherryWorks Pro"; };
  }, [pageTitle]);
}
