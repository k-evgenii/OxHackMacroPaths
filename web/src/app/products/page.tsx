import { Suspense } from "react";
import { ProductsPage } from "@/features/products/ProductsPage";

// ProductsPage reads useSearchParams(); the Suspense boundary lets the route prerender its shell
// instead of failing the static export (missing-suspense-with-csr-bailout).
export default function Page() {
  return (
    <Suspense fallback={null}>
      <ProductsPage />
    </Suspense>
  );
}
