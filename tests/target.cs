using System;
using System.Diagnostics;
using System.Data.SqlClient;

namespace Demo
{
    public class Svc
    {
        private const string Secret = "f449a71cff1d56a122c84fa478c16af9075e5b4b8527787b56580773242e40ce";
        private const string Role = "User";

        public static void Run(string input, int n)
        {
            Console.WriteLine("hello");
            Console.WriteLine("hello" + " world");
            Console.WriteLine($"hi {input}");
            var cmd = new SqlCommand("SELECT * FROM t WHERE x = " + input);
            Process.Start(input);
            if (input == null)
            {
                Console.WriteLine("null");
            }
            try
            {
                Process.Start("cmd.exe", input);
            }
            catch (Exception ex)
            {
                throw ex;
            }
            var t = DateTime.Now;
            int total = 0;
            total += n;
            while (n > 0) { total /= 2; n--; }
        }

        public void Helper(string s)
        {
            Foo(s.ToLower());
            Foo(Clean(s.ToLower()));
        }

        private static void Foo(string s) { }
        private static string Clean(string s) { return s; }
    }
}
