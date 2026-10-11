/** `next/navigation` and `next/link` hooks the shell reads, for the fixture. */
export const usePathname = () => "/en/ai-usage";
export const useSearchParams = () =>
  new URLSearchParams(window.location.search);
export const useRouter = () => ({
  push: () => undefined,
  replace: () => undefined,
  prefetch: () => undefined,
  back: () => undefined,
  refresh: () => undefined,
});
export const useParams = () => ({});
export const redirect = () => undefined;
export const notFound = () => undefined;
export const useLinkStatus = () => ({ pending: false });
export default function Link() {
  return null;
}
