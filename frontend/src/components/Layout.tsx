import { ReactNode } from 'react';
import Head from 'next/head';

interface LayoutProps {
  children: ReactNode;
}

const Layout: React.FC<LayoutProps> = ({ children }) => {
  return (
    <>
      <Head>
        <link
          href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@500;700&family=Montserrat:wght@400;600&display=swap"
          rel="stylesheet"
        />
      </Head>
      <div
        className="flex justify-center items-center min-h-screen bg-cover bg-center"
        style={{ backgroundImage: "url('/images/aa.jpg')" }}
      >
        {children}
        <footer className="absolute bottom-0 w-full text-center text-white py-4 bg-black bg-opacity-50">
          <p>Follow us on social media</p>
          <div className="flex justify-center space-x-4 mt-2">
            <a href="#" className="hover:text-pink-500">🔗 Facebook</a>
            <a href="#" className="hover:text-pink-500">🔗 LinkedIn</a>
            <a href="#" className="hover:text-pink-500">🔗 Instagram</a>
          </div>
        </footer>
      </div>
    </>
  );
};

export default Layout;