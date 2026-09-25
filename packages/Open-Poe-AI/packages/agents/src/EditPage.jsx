"use client";

import EditAgent from "./components/EditAgent";
import { Toaster } from "react-hot-toast";

const EditAgentPage = ({ locale = "en" }) => {
  return (
    <div className="h-dvh w-full flex flex-col bg-gray-100 dark:bg-primary-bg transition-all duration-300 ease-in-out">
      <Toaster position="top-center" reverseOrder={false} />
      <main className="flex flex-col items-center gap-2 w-full h-full overflow-y-auto pt-8">
        <EditAgent locale={locale} />
      </main>
    </div>
  );
};

export default EditAgentPage;
